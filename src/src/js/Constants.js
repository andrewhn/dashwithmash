export default {
  // event name triggered from store, listened to by views
  CHANGE_EVENT: 'change',

  // Each time you add an action, add it here... They should be past-tense
  ActionTypes: {
    SEND_WS_DATA: 'SEND_WS_DATA',
    MOCK_WS_DATA: 'MOCK_WS_DATA',
    RECONNECT_SOCKET: 'RECONNECT_SOCKET',
  },

  ActionSources: {
    SERVER_ACTION: 'SERVER_ACTION',
    VIEW_ACTION: 'VIEW_ACTION',
  }
};
