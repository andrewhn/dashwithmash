import Dispatcher from '../Dispatcher';
import Constants from '../Constants';
import BaseStore from './BaseStore';
import assign from 'object-assign';

let _data;
let _requiresReconnect = false;
const _queue = [];  // fifo

const _connect = () => {

  // let _connection = new WebSocket("wss://dashwithmash.com/ws");
  let _connection = new WebSocket("ws://10.1.1.9:8081");

  _connection.onopen = () => {
    _requiresReconnect = false;
    while (_queue.length) {
      _connection.send(_queue.shift());
    }
    // SocketStore.emitChange();
  }

  _connection.onmessage = message => {
    _data = JSON.parse(message.data);
    SocketStore.emitChange();
  }

  _connection.onclose = () => {
    _requiresReconnect = true;
    SocketStore.emitChange();
  }

  return _connection;
}

let _connection = _connect();

const SocketStore = assign({}, BaseStore, {

  isConnected() {
    return _connection.readyState == 1;
  },

  getMessage() {
    return _data;
  },

  requiresReconnect() {
    return _requiresReconnect;
  },

  dispatcherIndex: Dispatcher.register(payload => {
    const action = payload.action;

    switch (action.type) {
      case Constants.ActionTypes.MOCK_WS_DATA:
        _data = action.data;
        SocketStore.emitChange();
        break;
      case Constants.ActionTypes.RECONNECT_SOCKET:
        _connection = _connect();
      case Constants.ActionTypes.SEND_WS_DATA:
        const msgPayload = JSON.stringify(action.data);
        if (_connection.readyState == 1) {
          _connection.send(msgPayload);
        } else {
          _queue.push(msgPayload);
        }
        break;
    }
  })

});

export default SocketStore;
