import Dispatcher from '../Dispatcher';
import Constants from '../Constants';

/* eslint-disable no-console */


export default {

  sendWSData(action, payload) {
    Dispatcher.handleViewAction({
      type: Constants.ActionTypes.SEND_WS_DATA,
      data: {action: action, payload: payload}
    });
  },

  mockWSData(payload) {
    Dispatcher.handleViewAction({
      type: Constants.ActionTypes.MOCK_WS_DATA,
      data: payload,
    });
  },

  reconnectSocket(playerId) {
    Dispatcher.handleViewAction({
      type: Constants.ActionTypes.RECONNECT_SOCKET,
      data: {action: 're-join', payload: playerId},
    })
  },

};
