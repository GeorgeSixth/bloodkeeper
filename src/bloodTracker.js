import sqlite3 from 'sqlite3';
import { promisify } from 'util';

// Blood level management for VTM chronicle
const TZIMISCE_BOT_ID = '642775025770037279';
const BLOOD_CHANNEL_ID = '1339973204201963633';

export class BloodTracker {
  constructor() {
    this.dbPath = process.env.DB_PATH || './data/bloodkeeper.db';
    this.db = null;
  }

  async initializeDatabase() {
    // Create data directory if it doesn't exist
    const path = await import('path');
    const fs = await import('fs');
    const dataDir = path.dirname(this.dbPath);
    
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('Database connection error:', err);
          reject(err);
        } else {
          console.log('📊 Connected to SQLite database');
          this.createTables().then(resolve).catch(reject);
        }
      });
    });
  }

  async createTables() {
    const createBloodLevelTable = `
      CREATE TABLE IF NOT EXISTS blood_level (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level INTEGER NOT NULL,
        last_reset TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createBloodHistoryTable = `
      CREATE TABLE IF NOT EXISTS blood_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        successes INTEGER NOT NULL,
        blood_level INTEGER NOT NULL,
        message_content TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run(createBloodLevelTable);
        this.db.run(createBloodHistoryTable);
        
        // Initialize with default blood level if not exists
        this.db.get("SELECT COUNT(*) as count FROM blood_level", (err, row) => {
          if (err) {
            reject(err);
          } else if (row.count === 0) {
            this.db.run(
              "INSERT INTO blood_level (level, last_reset) VALUES (?, ?)",
              [200, new Date().toISOString()],
              (err) => {
                if (err) reject(err);
                else {
                  console.log('🩸 Initialized blood level to 200');
                  resolve();
                }
              }
            );
          } else {
            resolve();
          }
        });
      });
    });
  }

  async getCurrentBloodLevel() {
    if (!this.db) {
      throw new Error('Database not initialized. Call initializeDatabase() first.');
    }
    
    return new Promise((resolve, reject) => {
      this.db.get(
        "SELECT level FROM blood_level ORDER BY id DESC LIMIT 1",
        (err, row) => {
          if (err) reject(err);
          else resolve(row ? row.level : 200);
        }
      );
    });
  }

  async setBloodLevel(amount) {
    if (!this.db) {
      throw new Error('Database not initialized. Call initializeDatabase() first.');
    }
    
    return new Promise((resolve, reject) => {
      this.db.run(
        "INSERT INTO blood_level (level, last_reset) VALUES (?, ?)",
        [amount, new Date().toISOString()],
        function(err) {
          if (err) reject(err);
          else resolve(amount);
        }
      );
    });
  }

  async decreaseBloodLevel(amount) {
    const current = await this.getCurrentBloodLevel();
    const newLevel = Math.max(0, current - amount);
    await this.setBloodLevel(newLevel);
    return newLevel;
  }

  async getLastReset() {
    return new Promise((resolve, reject) => {
      this.db.get(
        "SELECT last_reset FROM blood_level ORDER BY id DESC LIMIT 1",
        (err, row) => {
          if (err) reject(err);
          else resolve(row ? new Date(row.last_reset) : new Date());
        }
      );
    });
  }

  async setLastReset(date = new Date()) {
    return new Promise((resolve, reject) => {
      this.db.run(
        "UPDATE blood_level SET last_reset = ? WHERE id = (SELECT MAX(id) FROM blood_level)",
        [date.toISOString()],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async checkAndResetMonthly() {
    const lastReset = await this.getLastReset();
    const now = new Date();
    
    // Check if a month has passed
    const monthsDiff = (now.getFullYear() - lastReset.getFullYear()) * 12 + (now.getMonth() - lastReset.getMonth());
    
    if (monthsDiff >= 1) {
      await this.setBloodLevel(200);
      await this.setLastReset(now);
      console.log('🗓️ Monthly blood reset completed');
      return true;
    }
    return false;
  }

  async addBloodHistory(successes, bloodLevel, messageContent = null) {
    return new Promise((resolve, reject) => {
      this.db.run(
        "INSERT INTO blood_history (successes, blood_level, message_content) VALUES (?, ?, ?)",
        [successes, bloodLevel, messageContent],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  async getBloodHistory(limit = 10) {
    return new Promise((resolve, reject) => {
      this.db.all(
        "SELECT * FROM blood_history ORDER BY timestamp DESC LIMIT ?",
        [limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  parseTzimisceRoll(messageContent) {
    // Parse Tzimisce bot roll results
    // Common patterns for success counting in dice bots:
    const successPatterns = [
      /successes?:\s*(\d+)/i,
      /(\d+)\s+successes?/i,
      /total successes?:\s*(\d+)/i,
      /result:\s*(\d+)\s+successes?/i,
      /success.*?(\d+)/i,
      /(\d+).*?success/i,
    ];

    for (const pattern of successPatterns) {
      const match = messageContent.match(pattern);
      if (match) {
        return parseInt(match[1]);
      }
    }

    return 0;
  }

  shouldProcessMessage(message) {
    return message.author.id === TZIMISCE_BOT_ID && 
           message.channel_id === BLOOD_CHANNEL_ID;
  }

  async processRollMessage(message) {
    if (!this.shouldProcessMessage(message)) {
      return null;
    }

    // Check for monthly reset first
    const wasReset = await this.checkAndResetMonthly();

    let successes = 0;
    
    // Parse message content
    if (message.content) {
      successes = this.parseTzimisceRoll(message.content);
    }

    // Also check embeds if the bot uses them
    if (message.embeds && message.embeds.length > 0) {
      for (const embed of message.embeds) {
        if (embed.description) {
          const embedSuccesses = this.parseTzimisceRoll(embed.description);
          successes = Math.max(successes, embedSuccesses);
        }
        if (embed.fields) {
          for (const field of embed.fields) {
            const fieldSuccesses = this.parseTzimisceRoll(field.value);
            successes = Math.max(successes, fieldSuccesses);
          }
        }
      }
    }

    if (successes > 0) {
      const newBloodLevel = await this.decreaseBloodLevel(successes);
      
      // Add to history
      await this.addBloodHistory(successes, newBloodLevel, message.content);
      
      console.log(`🩸 Blood consumed: ${successes} successes, new level: ${newBloodLevel}`);
      
      return {
        successes,
        newBloodLevel,
        wasReset
      };
    }

    return null;
  }
}
