export const PING_COMMAND = {
  name: 'ping',
  description: 'Responds with pong!',
  type: 1, // CHAT_INPUT
};

export const BLOOD_LEVEL_COMMAND = {
  name: 'bloodlevel',
  description: 'Check the current blood level of the city',
  type: 1, // CHAT_INPUT
};

export const SET_BLOOD_COMMAND = {
  name: 'setblood',
  description: 'Set the blood level (admin only)',
  type: 1, // CHAT_INPUT
  options: [
    {
      name: 'amount',
      description: 'Blood level amount',
      type: 4, // INTEGER
      required: true,
    },
  ],
};

export const BLOOD_HISTORY_COMMAND = {
  name: 'bloodhistory',
  description: 'View recent blood consumption history',
  type: 1, // CHAT_INPUT
};

export const commands = [PING_COMMAND, BLOOD_LEVEL_COMMAND, SET_BLOOD_COMMAND, BLOOD_HISTORY_COMMAND];
