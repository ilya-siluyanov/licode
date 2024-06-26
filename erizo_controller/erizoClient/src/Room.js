import ErizoConnectionManager from './ErizoConnectionManager';
import ConnectionHelpers from './utils/ConnectionHelpers';
import { EventDispatcher, StreamEvent, RoomEvent } from './Events';
import { Socket } from './Socket';
import Stream from './Stream';
import ErizoMap from './utils/ErizoMap';
import Base64 from './utils/Base64';
import Logger from './utils/Logger';

const log = Logger.module('Room');
/*
 * Class Room represents a Licode Room. It will handle the connection, local stream publication and
 * remote stream subscription.
 * Typical Room initialization would be:
 * var room = Erizo.Room({token:'213h8012hwduahd-321ueiwqewq'});
 * It also handles RoomEvents and StreamEvents. For example:
 * Event 'room-connected' points out that the user has been successfully connected to the room.
 * Event 'room-disconnected' shows that the user has been already disconnected.
 * Event 'stream-added' indicates that there is a new stream available in the room.
 * Event 'stream-removed' shows that a previous available stream has been removed from the room.
 */


const STUN_SERVERS = [
  { 'urls': 'stun:stun.l.google.com:19302' },
  { 'urls': 'stun:51.250.100.5:3478' },
]

// const TURN_SERVERS = [
//   { 'urls': 'turn:51.250.100.5:3478', 'username': 'test', 'credential': 'test123'}
// ]

const TURN_SERVERS = []


const ReplicaState = () => {
  return {
    streams: ErizoMap()
  }
}

const MasterState = () => {
  return {
    clients: ErizoMap()
  }
}

const NetState = () => {
  return {
    ips: new Set([]),
    conn: undefined,
  }
}

const RelayState = () => {
  that = EventDispatcher()
  that.masterId = undefined
  that.masterState = undefined
  that.replicaState = undefined
  that.netState = NetState()
  return that
}
const Room = (altIo, altConnectionHelpers, altConnectionManager, specInput) => {
  const spec = specInput;
  const that = EventDispatcher(specInput);
  const DISCONNECTED = 0;
  const CONNECTING = 1;
  const CONNECTED = 2;


  that.remoteStreams = ErizoMap();
  that.localStreams = ErizoMap();
  that.roomID = '';
  that.clientId = '';
  that.relayState = RelayState()
  that.state = DISCONNECTED;
  that.p2p = false;
  that.minConnectionQualityLevel = '';
  that.ConnectionHelpers =
    altConnectionHelpers === undefined ? ConnectionHelpers : altConnectionHelpers;

  that.erizoConnectionManager =
    altConnectionManager === undefined ? new ErizoConnectionManager()
      : new altConnectionManager.ErizoConnectionManager();

  that.disableIceRestart = !!spec.disableIceRestart;
  let socket = Socket(altIo);
  that.socket = socket;
  let remoteStreams = that.remoteStreams;
  let localStreams = that.localStreams;
  // Private functions
  const toLog = () => `roomId: ${that.roomID.length > 0 ? that.roomID : 'undefined'}`;

  const removeStream = (streamInput) => {
    const stream = streamInput;
    stream.removeAllListeners();

    if (stream.pc && !that.p2p) {
      stream.pc.removeStream(stream);
    }

    log.debug(`message: Removed stream, ${stream.toLog()}, ${toLog()}`);
    if (stream.stream) {
      // Remove HTML element
      stream.hide();

      stream.stop();
      stream.close();
      delete stream.stream;
    }

    // Close PC stream
    if (stream.pc) {
      if (stream.local && that.p2p) {
        stream.pc.forEach((connection, id) => {
          connection.close();
          stream.pc.remove(id);
        });
      } else {
        that.erizoConnectionManager.maybeCloseConnection(stream.pc);
        delete stream.pc;
      }
    }
  };

  const maybeDispatchStreamSubscribed = (streamInput, evt) => {
    const stream = streamInput;
    // Draw on html
    log.info(`message: Stream subscribed, ${stream.toLog()}, ${toLog()}`);
    stream.stream = evt.stream;
    if (!that.p2p) {
      stream.pc.addStream(stream);
    }
    if (stream.state !== 'subscribed') {
      stream.state = 'subscribed';
      const evt2 = StreamEvent({ type: 'stream-subscribed', stream });
      that.dispatchEvent(evt2);
    }
  };

  const maybeDispatchStreamUnsubscribed = (streamInput) => {
    const stream = streamInput;
    log.debug(`message: Unsubscribing Stream, ${stream.toLog()}, unsubscribing: ${stream.unsubscribing}, ${toLog()}`);
    if (stream && stream.unsubscribing.callbackReceived &&
      (stream.unsubscribing.pcEventReceived || stream.failed)) {
      log.info(`message: Stream fully unsubscribed, ${stream.toLog()}, ${toLog()}`);
      stream.unsubscribing.callbackReceived = false;
      stream.unsubscribing.pcEventReceived = false;
      removeStream(stream);
      delete stream.failed;
      stream.state = 'unsubscribed';
      const evt2 = StreamEvent({ type: 'stream-unsubscribed', stream });
      that.dispatchEvent(evt2);
    } else {
      log.debug(`message: Not dispatching stream unsubscribed yet, ${stream.toLog()}, ${toLog()}`);
    }
  };

  const onStreamFailed = (streamInput, message, origin = 'unknown', wasAbleToConnect = false) => {
    const stream = streamInput;
    if (that.state !== DISCONNECTED && stream && !stream.failed) {
      stream.failed = true;

      const streamFailedEvt = StreamEvent(
        {
          type: 'stream-failed',
          msg: message || 'Stream failed after connection',
          stream,
          origin,
          wasAbleToConnect
        });
      that.dispatchEvent(streamFailedEvt);
      const connection = stream.pc;

      if (stream.local) {
        that.unpublish(stream);
      } else if (stream.unsubscribing.callbackReceived) {
        maybeDispatchStreamUnsubscribed(stream);
      } else {
        that.unsubscribe(stream);
      }

      if (connection && spec.singlePC) {
        console.error("Close connection")
        that.erizoConnectionManager.maybeCloseConnection(connection, true);
      }
    }
  };


  const getP2PConnectionOptions = (stream, peerSocket) => {
    const options = {
      callback(msg, streamIds) {
        socket.sendSDP('streamMessageP2P', {
          streamId: stream.getID(),
          streamIds,
          peerSocket,
          msg
        });
      },
      audio: stream.hasAudio(),
      video: stream.hasVideo(),
      iceServers: that.iceServers,
      maxAudioBW: stream.maxAudioBW,
      maxVideoBW: stream.maxVideoBW,
      limitMaxAudioBW: spec.maxAudioBW,
      limitMaxVideoBW: spec.maxVideoBW,
      forceTurn: stream.forceTurn,
      p2p: true,
      disableIceRestart: that.disableIceRestart,
    };
    return options;
  };

  const createRemoteStreamP2PConnection = (streamInput, peerSocket) => {
    const stream = streamInput;
    const connectionOptions = getP2PConnectionOptions(stream, peerSocket);
    const connection = that.erizoConnectionManager.getOrBuildErizoConnection(connectionOptions);
    stream.addPC(connection, false, connectionOptions);
    connection.on('connection-failed', that.dispatchEvent.bind(this));
    stream.on('added', maybeDispatchStreamSubscribed.bind(null, stream));
    stream.on('icestatechanged', (evt) => {
      log.debug(`message: icestatechanged, ${stream.toLog()}, iceConnectionState: ${evt.msg.state}, ${toLog()}`);
      if (evt.msg.state === 'failed') {
        const message = 'ICE Connection Failed';
        onStreamFailed(stream, message, 'ice-client', evt.msg.wasAbleToConnect);
      }
    });
  };

  const createLocalStreamP2PConnection = (streamInput, peerSocket) => {
    const stream = streamInput;
    const connection = that.erizoConnectionManager.getOrBuildErizoConnection(
      getP2PConnectionOptions(stream, peerSocket));

    stream.addPC(connection, peerSocket);
    connection.on('connection-failed', that.dispatchEvent.bind(this));

    stream.on('icestatechanged', (evt) => {
      log.debug(`message: icestatechanged, streamId: ${stream.getID()}, iceConnectionState: ${evt.msg.state}, ${toLog()}`);
      if (evt.msg.state === 'failed') {
        stream.pc.get(peerSocket).close();
        stream.pc.remove(peerSocket);
      }
    });
    connection.addStream(stream);
  };

  const removeLocalStreamP2PConnection = (streamInput, peerSocket) => {
    const stream = streamInput;
    if (stream.pc === undefined || !stream.pc.has(peerSocket)) {
      return;
    }
    const pc = stream.pc.get(peerSocket);
    pc.close();
    stream.pc.remove(peerSocket);
  };

  const onRemoteStreamRemovedListener = (label) => {
    that.remoteStreams.forEach((stream) => {
      if (!stream.local && stream.getLabel() === label) {
        const streamToRemove = stream;
        streamToRemove.unsubscribing.pcEventReceived = true;
        maybeDispatchStreamUnsubscribed(streamToRemove);
      }
    });
  };

  const getErizoConnectionOptions = (stream, connectionId, erizoId, options, isRemote) => {
    const connectionOpts = {
      callback(message, streamId = stream.getID()) {
        if (message && message.type && message.type === 'updatestream') {
          socket.sendSDP('streamMessage', {
            streamId,
            erizoId,
            msg: message,
            browser: stream.pc && stream.pc.browser
          }, undefined, () => { });
        } else {
          socket.sendSDP('connectionMessage', {
            connectionId,
            erizoId,
            msg: message,
            browser: stream.pc && stream.pc.browser
          }, undefined, () => { });
        }
      },
      connectionId,
      nop2p: true,
      audio: options.audio && stream.hasAudio(),
      video: options.video && stream.hasVideo(),
      maxAudioBW: options.maxAudioBW,
      maxVideoBW: options.maxVideoBW,
      simulcast: options.simulcast,
      limitMaxAudioBW: spec.maxAudioBW,
      limitMaxVideoBW: spec.maxVideoBW,
      label: stream.getLabel(),
      iceServers: that.iceServers,
      disableIceRestart: that.disableIceRestart,
      forceTurn: stream.forceTurn,
      p2p: false,
      streamRemovedListener: onRemoteStreamRemovedListener,
      isRemote,
    };
    if (!isRemote) {
      connectionOpts.startVideoBW = options.startVideoBW;
      connectionOpts.hardMinVideoBW = options.hardMinVideoBW;
    }
    return connectionOpts;
  };

  const createRemoteStreamErizoConnection = (streamInput, connectionId, erizoId, options) => {
    const stream = streamInput;
    const connectionOpts = getErizoConnectionOptions(stream, connectionId, erizoId, options, true);
    const connection = that.erizoConnectionManager
      .getOrBuildErizoConnection(connectionOpts, erizoId, spec.singlePC);
    stream.addPC(connection, false, connectionOpts);
    connection.on('connection-failed', that.dispatchEvent.bind(this));

    stream.on('added', maybeDispatchStreamSubscribed.bind(null, stream));
    stream.on('icestatechanged', (evt) => {
      log.debug(`message: icestatechanged, ${stream.toLog()}, iceConnectionState: ${evt.msg.state}, ${toLog()}`);
      if (evt.msg.state === 'failed') {
        const message = 'ICE Connection Failed';
        onStreamFailed(stream, message, 'ice-client', evt.msg.wasAbleToConnect);
        if (spec.singlePC) {
          connectionOpts.callback({ type: 'failed' });
        }
      }
      if (evt.msg.state === 'connected') {
        let pair = connection.peerConnection.getReceivers()[0].transport.iceTransport.getSelectedCandidatePair()
        let localPair = pair.local
        fetch("https://collector.webrtc-thesis.ru/connections", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // 'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: JSON.stringify({
            ts: new Date().toISOString(),
            clientId: 'SFU',
            edge: {
              targetId: that.clientId,
              type_: "add",
              candidateAddr: `${localPair.address}:${localPair.port}`
            }
          })
        })
          .then(() => { })
          .catch((err) => console.error(err))
      }
    });
  };

  const createLocalStreamErizoConnection = (streamInput, connectionId, erizoId, options) => {
    const stream = streamInput;
    const connectionOpts = getErizoConnectionOptions(stream, connectionId, erizoId, options);
    const connection = that.erizoConnectionManager
      .getOrBuildErizoConnection(connectionOpts, erizoId, spec.singlePC);
    stream.addPC(connection, false, options);
    connection.on('connection-failed', that.dispatchEvent.bind(this));
    stream.on('icestatechanged', (evt) => {
      log.debug(`message: icestatechanged, ${stream.toLog()}, iceConnectionState: ${evt.msg.state}, ${toLog()}`);
      if (evt.msg.state === 'failed') {
        const message = 'ICE Connection Failed';
        onStreamFailed(stream, message, 'ice-client', evt.msg.wasAbleToConnect);
        if (spec.singlePC) {
          connectionOpts.callback({ type: 'failed' });
        }
      }
      if (evt.msg.state === 'connected') {
        let pair = connection.peerConnection.getReceivers()[0].transport.iceTransport.getSelectedCandidatePair()
        let remotePair = pair.remote
        fetch("https://collector.webrtc-thesis.ru/connections", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ts: new Date().toISOString(),
            clientId: that.clientId,
            edge: {
              targetId: 'SFU',
              type_: "add",
              candidateAddr: `${remotePair.address}:${remotePair.port}`
            }
          })
        })
          .then(() => { })
          .catch((err) => console.error(err))
      }
    });
    stream.pc.addStream(stream);
  };

  const onConnectionFailed = (evt) => {
    console.log("OnConnectionFailed", evt)
    fetch("https://collector.webrtc-thesis.ru/connections", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // 'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: JSON.stringify({
        ts: new Date().toISOString(),
        clientId: 'SFU',
        edge: {
          targetId: that.clientId,
          type_: "delete",
          candidateAddr: 'nodata'
        }
      })
    })
      .then(() => { })
      .catch((err) => console.error(err))
  }


  // We receive an event with a new stream in the room.
  // type can be "media" or "data"

  const socketOnAddStream = (arg) => {
    if (remoteStreams.has(arg.id)) {
      return;
    }
    const stream = Stream(that.Connection, {
      streamID: arg.id,
      local: localStreams.has(arg.id),
      audio: arg.audio,
      video: arg.video,
      data: arg.data,
      label: arg.label,
      screen: arg.screen,
      attributes: arg.attributes
    });
    stream.room = that;
    stream.state = 'unsubscribed';
    remoteStreams.add(arg.id, stream);
    const evt = StreamEvent({ type: 'stream-added', stream });
    that.dispatchEvent(evt);
  };

  const socketOnStreamMessageFromErizo = (arg) => {
    log.debug(`message: Failed applying a stream message from erizo, ${toLog()}, msg: ${JSON.stringify(arg)}`);
  };

  const socketOnConnectionQualityLevel = (arg) => {
    const level = arg.evt.level;
    let minLevel = Number.MAX_SAFE_INTEGER;
    let minLevelMessage = '';
    localStreams.forEach((stream) => {
      if (!stream.failed && stream.pc) {
        if (stream.pc.connectionId === arg.connectionId) {
          stream.pc.setQualityLevel(level);
        }
        const streamLevel = stream.pc.getQualityLevel();
        if (streamLevel.index < minLevel) {
          minLevel = streamLevel.index;
          minLevelMessage = streamLevel.message;
        }
      }
    });
    remoteStreams.forEach((stream) => {
      if (!stream.failed && stream.pc) {
        if (stream.pc.connectionId === arg.connectionId) {
          stream.pc.setQualityLevel(level);
        }
        const streamLevel = stream.pc.getQualityLevel();
        if (streamLevel.index < minLevel) {
          minLevel = streamLevel.index;
          minLevelMessage = streamLevel.message;
        }
      }
    });
    if (minLevelMessage !== that.minConnectionQualityLevel) {
      that.minConnectionQualityLevel = minLevelMessage;
      that.dispatchEvent(RoomEvent({ type: 'quality-level', message: minLevelMessage }));
    }
  };

  const socketOnConnectionMessageFromErizo = (arg) => {
    if (arg.evt.type === 'quality_level') {
      socketOnConnectionQualityLevel(arg);
      return;
    }
    const connection = that.erizoConnectionManager.getErizoConnection(arg.connectionId);
    if (connection) {
      connection.processSignalingMessage(arg.evt);
    } else {
      log.warning(`message: Received signaling message to unknown connectionId, connectionId: ${arg.connectionId}, ${toLog()}`);
    }
  };

  const socketOnStreamMessageFromP2P = (arg) => {
    let stream = localStreams.get(arg.streamId);

    if (stream && !stream.failed) {
      stream.pc.get(arg.peerSocket).processSignalingMessage(arg.msg);
    } else {
      stream = remoteStreams.get(arg.streamId);

      if (!stream.pc) {
        createRemoteStreamP2PConnection(stream, arg.peerSocket);
      }
      stream.pc.processSignalingMessage(arg.msg);
    }
  };

  const socketOnPublishMe = (arg) => {
    const myStream = localStreams.get(arg.streamId);

    createLocalStreamP2PConnection(myStream, arg.peerSocket);
  };

  const socketOnUnpublishMe = (arg) => {
    const myStream = localStreams.get(arg.streamId);
    if (myStream) {
      removeLocalStreamP2PConnection(myStream, arg.peerSocket);
    }
  };

  const socketOnBandwidthAlert = (arg) => {
    log.debug(`message: Bandwidth Alert, streamId: ${arg.streamID}, bwMessage: ${arg.message}, bandwidth: ${arg.bandwidth}, ${toLog()}`);
    if (arg.streamID) {
      const stream = remoteStreams.get(arg.streamID);
      if (stream && !stream.failed) {
        const evt = StreamEvent({
          type: 'bandwidth-alert',
          stream,
          msg: arg.message,
          bandwidth: arg.bandwidth
        });
        stream.dispatchEvent(evt);
      }
    }
  };

  // We receive an event of new data in one of the streams
  const socketOnDataStream = (arg) => {
    const stream = remoteStreams.get(arg.id);
    const evt = StreamEvent({ type: 'stream-data', msg: arg.msg, stream });
    stream.dispatchEvent(evt);
  };

  // We receive an event of new data in one of the streams
  const socketOnUpdateAttributeStream = (arg) => {
    const stream = remoteStreams.get(arg.id);
    const evt = StreamEvent({
      type: 'stream-attributes-update',
      attrs: arg.attrs,
      stream
    });
    stream.updateLocalAttributes(arg.attrs);
    stream.dispatchEvent(evt);
  };

  // We receive an event of a stream removed from the room
  const socketOnRemoveStream = (arg) => {
    let stream = localStreams.get(arg.id);
    if (stream) {
      onStreamFailed(stream, 'Stream removed from server', 'server');
      return;
    }
    stream = remoteStreams.get(arg.id);
    if (stream) {
      log.info(`message: Stream removed, ${stream.toLog()}, ${toLog()}`);
      removeStream(stream);
      remoteStreams.remove(arg.id);
      const evt = StreamEvent({ type: 'stream-removed', stream });
      that.dispatchEvent(evt);
    }
  };

  // The socket has disconnected
  const socketOnDisconnect = () => {
    log.info(`message: Socket disconnected, reason: lost connection to ErizoController, ${toLog()}`);
    if (that.state !== DISCONNECTED) {
      log.error(`message: Unexpected disconnection from ErizoController, ${toLog()}`);
      const disconnectEvt = RoomEvent({
        type: 'room-disconnected',
        message: 'unexpected-disconnection'
      });
      that.dispatchEvent(disconnectEvt);
    }
  };

  const socketOnReconnecting = (reason) => {
    log.info(`message: Socket reconnecting, reason: lost connection to ErizoController, ${toLog()}`);
    const reconnectingEvt = RoomEvent({
      type: 'room-reconnecting',
      message: `reconnecting - ${reason}`
    });
    that.dispatchEvent(reconnectingEvt);
  };

  const socketOnReconnected = () => {
    log.info(`message: Socket reconnected, reason: restablished connection to ErizoController, ${toLog()}`);
    const reconnectedEvt = RoomEvent({
      type: 'room-reconnected',
      message: 'reconnected'
    });
    that.dispatchEvent(reconnectedEvt);
  };

  const socketOnICEConnectionFailed = (arg) => {
    let stream;
    if (!arg.streamId) {
      return;
    }
    const message = `message: ICE Connection Failed, type: ${arg.type}, streamId: ${arg.streamId}, state: ${that.state}, ${toLog()}`;
    log.error(message);
    if (arg.type === 'publish') {
      stream = localStreams.get(arg.streamId);
    } else {
      stream = remoteStreams.get(arg.streamId);
    }
    onStreamFailed(stream, message, 'ice-server');
  };

  const socketOnError = (e) => {
    log.error(`message: Error in the connection to Erizo Controller, ${toLog()}, error: ${e}`);
    const connectEvt = RoomEvent({ type: 'room-error', message: e });
    that.dispatchEvent(connectEvt);
  };

  const sendDataSocketFromStreamEvent = (evt) => {
    const stream = evt.stream;
    const msg = evt.msg;
    if (stream.local) {
      that.socket.sendMessage('sendDataStream', { id: stream.getID(), msg });
    } else {
      log.error(`message: You can not send data through a remote stream, ${stream.toLog()}, ${toLog()}`);
    }
  };

  const updateAttributesFromStreamEvent = (evt) => {
    const stream = evt.stream;
    const attrs = evt.attrs;
    if (stream.local) {
      stream.updateLocalAttributes(attrs);
      that.socket.sendMessage('updateStreamAttributes', { id: stream.getID(), attrs });
    } else {
      log.error(`message: You can not update attributes in a remote stream, ${stream.toLog()}, ${toLog()}`);
    }
  };

  const socketEventToArgs = (func, event) => {
    if (event.args) {
      func(...event.args);
    } else {
      func();
    }
  };

  const createSdpConstraints = (type, stream, options) => ({
    state: type,
    data: stream.hasData(),
    audio: stream.hasAudio(),
    video: stream.hasVideo(),
    label: stream.getLabel(),
    screen: stream.hasScreen(),
    attributes: stream.getAttributes(),
    metadata: options.metadata,
    createOffer: options.createOffer,
    muteStream: options.muteStream,
    encryptTransport:
      (options.encryptTransport === undefined) ? true : options.encryptTransport,
    handlerProfile: options.handlerProfile,
  });

  const populateStreamFunctions = (id, streamInput, error, callback = () => { }) => {
    const stream = streamInput;
    if (id === null) {
      log.error(`message: Error when publishing the stream, ${stream.toLog()}, ${toLog()}, error: ${error}`);
      // Unauth -1052488119
      // Network -5
      callback(undefined, error);
      return;
    }
    log.info(`message: Stream published, ${stream.toLog()}, ${toLog()}`);
    stream.getID = () => id;
    stream.on('internal-send-data', sendDataSocketFromStreamEvent);
    stream.on('internal-set-attributes', updateAttributesFromStreamEvent);
    localStreams.add(id, stream);
    stream.room = that;
    callback(id);
  };

  const publishExternal = (streamInput, options, callback = () => { }) => {
    const stream = streamInput;
    let type;
    let arg;
    if (stream.url) {
      type = 'url';
      arg = stream.url;
    } else {
      type = 'recording';
      arg = stream.recording;
    }
    log.debug(`message: Checking publish options, ${stream.toLog()}, ${toLog()}`);
    stream.checkOptions(options);
    socket.sendSDP('publish', createSdpConstraints(type, stream, options), arg,
      (id, error) => {
        populateStreamFunctions(id, stream, error, callback);
      });
  };

  const publishP2P = (streamInput, options, callback = () => { }) => {
    const stream = streamInput;
    // We save them now to be used when actually publishing in P2P mode.
    stream.maxAudioBW = options.maxAudioBW;
    stream.maxVideoBW = options.maxVideoBW;
    socket.sendSDP('publish', createSdpConstraints('p2p', stream, options), undefined, (id, error) => {
      populateStreamFunctions(id, stream, error, callback);
    });
  };

  const publishData = (streamInput, options, callback = () => { }) => {
    const stream = streamInput;
    socket.sendSDP('publish', createSdpConstraints('data', stream, options), undefined, (id, error) => {
      populateStreamFunctions(id, stream, error, callback);
    });
  };

  const publishErizo = (streamInput, options, callback = () => { }) => {
    const stream = streamInput;
    log.debug(`message: Publishing to Erizo Normally, createOffer: ${options.createOffer}, ${toLog()}`);
    const constraints = createSdpConstraints('erizo', stream, options);
    constraints.minVideoBW = options.minVideoBW;
    constraints.maxVideoBW = options.maxVideoBW;
    constraints.scheme = options.scheme;

    socket.sendSDP('publish', constraints, undefined, (id, erizoId, connectionId, error) => {
      if (id === null) {
        log.error(`message: Error publishing stream, ${stream.toLog()}, ${toLog()}, error: ${error}`);
        callback(undefined, error);
        return;
      }
      populateStreamFunctions(id, stream, error, undefined);
      createLocalStreamErizoConnection(stream, connectionId, erizoId, options);
      callback(id);
    });
  };

  const getVideoConstraints = (stream, video) => {
    const hasVideo = video && stream.hasVideo();
    const width = video && video.width;
    const height = video && video.height;
    const frameRate = video && video.frameRate;
    if (width || height || frameRate) {
      return { width, height, frameRate };
    }
    return hasVideo;
  };

  const subscribeErizo = (streamInput, optionsInput, callback = () => { }) => {
    const stream = streamInput;
    const options = optionsInput;
    options.maxVideoBW = options.maxVideoBW || spec.defaultVideoBW;
    if (options.maxVideoBW > spec.maxVideoBW) {
      options.maxVideoBW = spec.maxVideoBW;
    }
    options.audio = (options.audio === undefined) ? true : options.audio;
    options.video = (options.video === undefined) ? true : options.video;
    options.data = (options.data === undefined) ? true : options.data;
    options.encryptTransport =
      (options.encryptTransport === undefined) ? true : options.encryptTransport;

    stream.checkOptions(options);
    const constraint = {
      streamId: stream.getID(),
      audio: options.audio && stream.hasAudio(),
      video: getVideoConstraints(stream, options.video),
      maxVideoBW: options.maxVideoBW,
      data: options.data && stream.hasData(),
      browser: that.ConnectionHelpers.getBrowser(),
      createOffer: options.createOffer,
      metadata: options.metadata,
      muteStream: options.muteStream,
      encryptTransport: options.encryptTransport,
      slideShowMode: options.slideShowMode,
      handlerProfile: options.handlerProfile,
    };
    socket.sendSDP('subscribe', constraint, undefined, (result, erizoId, connectionId, error) => {
      if (result === null) {
        log.error(`message: Error subscribing to stream, ${stream.toLog()}, ${toLog()}, error: ${error}`);
        stream.state = 'unsubscribed';
        callback(undefined, error);
        return;
      }

      log.debug(`message: Subscriber added, ${stream.toLog()}, ${toLog()}, erizoId: ${erizoId}, connectionId: ${connectionId}`);
      createRemoteStreamErizoConnection(stream, connectionId, erizoId, options);
      callback(true);
    });
  };

  const subscribeData = (streamInput, options, callback = () => { }) => {
    const stream = streamInput;
    socket.sendSDP('subscribe',
      {
        streamId: stream.getID(),
        data: options.data,
        metadata: options.metadata
      },
      undefined, (result, error) => {
        if (result === null) {
          log.error(`message: Error subscribing to stream, ${stream.toLog()}, ${toLog()}, error: ${error}`);
          stream.state = 'unsubscribed';
          callback(undefined, error);
          return;
        }
        log.debug(`message: Stream subscribed, ${stream.toLog()}, ${toLog()}`);
        const evt = StreamEvent({ type: 'stream-subscribed', stream });
        that.dispatchEvent(evt);
        callback(true);
      });
  };

  const clearAll = () => {
    that.state = DISCONNECTED;
    socket.state = socket.DISCONNECTED;

    // Close all PeerConnections
    that.erizoConnectionManager.ErizoConnectionsMap.forEach((connection) => {
      Object.keys(connection).forEach((key) => {
        connection[key].close();
      });
    });

    // Remove all streams
    remoteStreams.forEach((stream, id) => {
      removeStream(stream);
      remoteStreams.remove(id);
      if (stream && !stream.failed) {
        const evt2 = StreamEvent({ type: 'stream-removed', stream });
        that.dispatchEvent(evt2);
      }
    });
    remoteStreams = ErizoMap();

    // Close Peer Connections
    localStreams.forEach((stream, id) => {
      removeStream(stream);
      localStreams.remove(id);
    });
    localStreams = ErizoMap();

    // Close socket
    try {
      socket.disconnect(that.clientIntiatedDisconnection);
    } catch (error) {
      log.debug(`message: Socket already disconnected, ${toLog()}, error: ${error}`);
    }
    log.info(`message: Disconnected from room, roomId: ${that.roomID}, ${toLog()}`);
    socket = undefined;
  };

  // Public functions

  // It stablishes a connection to the room.
  // Once it is done it throws a RoomEvent("room-connected")
  that.connect = (options = {}) => {
    const token = JSON.parse(Base64.decodeBase64(spec.token));

    if (that.state !== DISCONNECTED) {
      log.warning(`message: Room already connected, roomId: ${that.roomID}, ${toLog()}`);
    }

    // 1- Connect to Erizo-Controller
    that.state = CONNECTING;
    that.clientIntiatedDisconnection = false;
    log.info(`message: Connecting to room, tokenId: ${token.tokenId}`);
    socket.connect(token, options, (response) => {
      let stream;
      const streamList = [];
      const streams = response.streams || [];
      const roomId = response.id;

      that.p2p = response.p2p;
      that.iceServers = response.iceServers;
      that.state = CONNECTED;
      spec.singlePC = response.singlePC;
      spec.defaultVideoBW = response.defaultVideoBW;
      spec.maxVideoBW = response.maxVideoBW;
      that.streamPriorityStrategy = response.streamPriorityStrategy;
      that.connectionTargetBw = response.connectionTargetBw;

      // 2- Retrieve list of streams
      const streamIndices = Object.keys(streams);
      for (let index = 0; index < streamIndices.length; index += 1) {
        const arg = streams[streamIndices[index]];
        stream = Stream(that.ConnectionHelpers, {
          streamID: arg.id,
          local: false,
          audio: arg.audio,
          video: arg.video,
          data: arg.data,
          label: arg.label,
          screen: arg.screen,
          attributes: arg.attributes
        });
        stream.room = that;
        stream.state = 'unsubscribed';
        streamList.push(stream);
        remoteStreams.add(arg.id, stream);
      }

      // 3 - Update RoomID
      that.roomID = roomId;
      that.clientId = response.clientId;

      log.info(`message: Connected to room, ${toLog()}`);

      const connectEvt = RoomEvent({ type: 'room-connected', streams: streamList });
      that.dispatchEvent(connectEvt);
    }, (error) => {
      log.error(`message: Error connecting to room, ${toLog()}, error: ${error}`);
      const connectEvt = RoomEvent({ type: 'room-error', message: error });
      that.dispatchEvent(connectEvt);
    });
  };

  // It disconnects from the room, dispatching a new RoomEvent("room-disconnected")
  that.disconnect = () => {
    log.info(`message: Disconnection requested, ${toLog()}`);
    // 1- Disconnect from room
    const disconnectEvt = RoomEvent({
      type: 'room-disconnected',
      message: 'expected-disconnection'
    });
    that.clientIntiatedDisconnection = true;
    that.dispatchEvent(disconnectEvt);
  };

  // It publishes the stream provided as argument. Once it is added it throws a
  // StreamEvent("stream-added").
  that.publish = (streamInput, optionsInput = {}, callback = () => { }) => {
    const stream = streamInput;
    const options = optionsInput;

    log.info(`message: Publishing stream, ${stream.toLog()}, ${toLog()}`);

    options.maxVideoBW = options.maxVideoBW || spec.defaultVideoBW;
    options.limitMaxVideoBW = spec.maxVideoBW;
    options.limitMaxAudioBW = spec.maxAudioBW;
    if (options.maxVideoBW > spec.maxVideoBW) {
      options.maxVideoBW = spec.maxVideoBW;
    }

    if (options.minVideoBW === undefined) {
      options.minVideoBW = 0;
    }

    if (options.minVideoBW > spec.defaultVideoBW) {
      options.minVideoBW = spec.defaultVideoBW;
    }

    stream.forceTurn = options.forceTurn;

    options.simulcast = options.simulcast || false;

    options.handlerProfile = options.handlerProfile || null;

    options.muteStream = {
      audio: stream.audioMuted,
      video: stream.videoMuted,
    };

    // 1- If the stream is not local or it is a failed stream we do nothing.
    if (stream && stream.local && !stream.failed && !localStreams.has(stream.getID())) {
      // 2- Publish Media Stream to Erizo-Controller
      if (stream.hasMedia()) {
        if (stream.isExternal()) {
          publishExternal(stream, options, callback);
        } else if (that.p2p) {
          publishP2P(stream, options, callback);
        } else {
          publishErizo(stream, options, callback);
        }
      } else if (stream.hasData()) {
        publishData(stream, options, callback);
      }
    } else {
      log.error(`message: Trying to publish invalid stream, ${stream.toLog()}, ${toLog()}`);
      callback(undefined, 'Invalid Stream');
    }
  };

  // Returns callback(id, error)
  that.startRecording = (stream, callback = () => { }) => {
    if (stream === undefined) {
      log.error(`message: Trying to start recording on an invalid stream, ${stream.toLog()}, ${toLog()}`);
      callback(undefined, 'Invalid Stream');
      return;
    }
    log.debug(`message: Start Recording stream, ${stream.toLog()}, ${toLog()}`);
    socket.sendMessage('startRecorder', { to: stream.getID() }, (id, error) => {
      if (id === null) {
        log.error(`message: Error on start recording, ${stream.toLog()}, ${toLog()}, error: ${error}`);
        callback(undefined, error);
        return;
      }

      log.debug(`message: Start recording, id: ${id}, ${toLog()}`);
      callback(id);
    });
  };

  // Returns callback(id, error)
  that.stopRecording = (recordingId, callback = () => { }) => {
    socket.sendMessage('stopRecorder', { id: recordingId }, (result, error) => {
      if (result === null) {
        log.error(`message: Error on stop recording, recordingId: ${recordingId}, ${toLog()}, error: ${error}`);
        callback(undefined, error);
        return;
      }
      log.debug(`message: Stop recording, id: ${recordingId}, ${toLog()}`);
      callback(true);
    });
  };

  // It unpublishes the local stream in the room, dispatching a StreamEvent("stream-removed")
  that.unpublish = (streamInput, callback = () => { }) => {
    const stream = that.localStreams.get(streamInput.getID());
    // Unpublish stream from Erizo-Controller
    if (stream && stream.local) {
      // Media stream
      socket.sendMessage('unpublish', stream.getID(), (result, error) => {
        if (result === null) {
          log.error(`message: Error unpublishing stream, ${stream.toLog()}, ${toLog()}, error: ${error}`);
          callback(undefined, error);
          return;
        }

        log.info(`message: Stream unpublished, ${stream.toLog()}, ${toLog()}`);

        delete stream.failed;
        callback(true);
      });

      log.info(`message: Unpublishing stream, ${stream.toLog()}, ${toLog()}`);
      stream.room = undefined;
      if (stream.hasMedia() && !stream.isExternal()) {
        const localStream = localStreams.has(stream.getID()) ?
          localStreams.get(stream.getID()) : stream;
        removeStream(localStream);
      }
      localStreams.remove(stream.getID());

      stream.getID = () => { };
      stream.off('internal-send-data', sendDataSocketFromStreamEvent);
      stream.off('internal-set-attributes', updateAttributesFromStreamEvent);
    } else {
      const error = `message: Cannot unpublish because stream does not exist or is not local, ${stream.toLog()}, ${toLog()}`;
      log.error(error);
      callback(undefined, error);
    }
  };

  that.sendControlMessage = (stream, type, action) => {
    if (stream && stream.getID()) {
      const msg = { type: 'control', action };
      socket.sendSDP('streamMessage', { streamId: stream.getID(), msg });
    }
  };

  // It subscribe to a remote stream and draws it inside the HTML tag given by the ID='elementID'
  that.subscribe = (streamInput, optionsInput = {}, callback = () => { }) => {
    const stream = that.remoteStreams.get(streamInput.getID());
    const options = optionsInput;

    if (stream && !stream.local && !stream.failed) {
      if (stream.state !== 'unsubscribed' && stream.state !== 'unsubscribing') {
        log.warning(`message: Cannot subscribe to a subscribed stream, ${stream.toLog()}, ${toLog()}`);
        callback(undefined, 'Stream already subscribed');
        return;
      }
      stream.state = 'subscribing';
      if (stream.hasMedia()) {
        // 1- Subscribe to Stream
        if (!stream.hasVideo() && !stream.hasScreen()) {
          options.video = false;
        }
        if (!stream.hasAudio()) {
          options.audio = false;
        }

        options.muteStream = {
          audio: stream.audioMuted,
          video: stream.videoMuted,
        };

        stream.forceTurn = options.forceTurn;

        if (that.p2p) {
          const streamToSubscribe = remoteStreams.get(stream.getID());
          streamToSubscribe.maxAudioBW = options.maxAudioBW;
          streamToSubscribe.maxVideoBW = options.maxVideoBW;
          socket.sendSDP('subscribe', { streamId: stream.getID(), metadata: options.metadata });
          callback(true);
        } else {
          subscribeErizo(stream, options, callback);
        }
      } else if (stream.hasData() && options.data !== false) {
        subscribeData(stream, options, callback);
      } else {
        log.warning(`message: There is nothing to subscribe to in stream, ${stream.toLog()}, ${toLog()}`);
        stream.state = 'unsubscribed';
        callback(undefined, 'Nothing to subscribe to');
        return;
      }
      // Subscribe to stream stream
      log.info(`message: Subscribing to stream, ${stream.toLog()}, ${toLog()}`);
    } else {
      let error = 'Error on subscribe';
      stream.state = 'unsubscribed';
      if (!stream) {
        log.warning(`message: Cannot subscribe to invalid stream, ${stream.toLog()}, ${toLog()}`);
        error = 'Invalid or undefined stream';
      } else if (stream.local) {
        log.warning(`message: Cannot subscribe to local stream, ${stream.toLog()}, ${toLog()}`);
        error = 'Local copy of stream';
      } else if (stream.failed) {
        log.warning(`message: Cannot subscribe to failed stream, ${stream.toLog()}, ${toLog()},` +
          `unsubscribing: ${stream.unsubscribing}, failed: ${stream.failed}`);
        error = 'Failed stream';
      }
      callback(undefined, error);
    }
  };

  // It unsubscribes from the stream, removing the HTML element.
  that.unsubscribe = (streamInput, callback = () => { }) => {
    const stream = that.remoteStreams.get(streamInput.getID());
    // Unsubscribe from stream
    if (socket !== undefined) {
      if (stream && !stream.local) {
        if (stream.state !== 'subscribed' && stream.state !== 'subscribing') {
          log.warning(`message: Cannot unsubscribe to a stream that is not subscribed, ${stream.toLog()}, ${toLog()}`);
          callback(undefined, 'Stream not subscribed');
          return;
        }
        stream.state = 'unsubscribing';
        log.info(`message: Unsubscribing stream, ${stream.toLog()}, ${toLog()}`);
        socket.sendMessage('unsubscribe', stream.getID(), (result, error) => {
          if (result === null) {
            stream.state = 'subscribed';
            callback(undefined, error);
            return;
          }
          callback(true);
          stream.unsubscribing.callbackReceived = true;
          maybeDispatchStreamUnsubscribed(stream);
        }, () => {
          stream.state = 'subscribed';
          log.error(`message: Error calling unsubscribe, ${stream.toLog()}, ${toLog()}`);
        });
      } else {
        stream.state = 'unsubscribed';
        callback(undefined,
          'Error unsubscribing, stream does not exist or is not local');
      }
    }
  };

  that.getStreamStats = (stream, callback = () => { }) => {
    if (!socket) {
      return 'Error getting stats - no socket';
    }
    if (!stream) {
      return 'Error getting stats - no stream';
    }

    socket.sendMessage('getStreamStats', stream.getID(), (result) => {
      if (result) {
        callback(result);
      }
    });
    return undefined;
  };

  // It searchs the streams that have "name" attribute with "value" value
  that.getStreamsByAttribute = (name, value) => {
    const streams = [];

    remoteStreams.forEach((stream) => {
      if (stream.getAttributes() !== undefined && stream.getAttributes()[name] === value) {
        streams.push(stream);
      }
    });

    return streams;
  };

  that.setStreamPriorityStrategy = (strategyId, callback = () => { }) => {
    socket.sendMessage('setStreamPriorityStrategy', strategyId, (result) => {
      that.streamPriorityStrategy = strategyId;
      if (result) {
        callback(result);
      }
    });
  };

  that.setConnectionTargetBandwidth = (connectionTargetBw, callback = () => { }) => {
    socket.sendMessage('setConnectionTargetBandwidth', connectionTargetBw, (result) => {
      that.connectionTargetBw = connectionTargetBw;
      if (result) {
        callback(result);
      }
    });
  };

  const reinitRelayState = () => {
    console.info("Start reinitting relay state")
    if (that.relayState.masterState !== undefined) {
      let clients = that.relayState.masterState.clients
      clients.forEach(client => {
        client.forEach(stream => {
          stream.close()
        })
      })
    }
    if (that.relayState.replicaState !== undefined) {
      let streams = that.relayState.replicaState.streams
      streams.forEach(stream => {
        stream.close()
      })
    }
    that.relayState.masterState = MasterState()
    that.relayState.replicaState = ReplicaState()
    console.info("Finish reinitting relay state")
  }

  const onBecomeLeaderIntent = () => {
    if (that.relayState.netState.ips === undefined) {
      log.warning("Subnet IP is not provided. Skip intent")
      return
    }
    if (that.relayState.masterId !== that.clientId) {
      reinitRelayState()
    }
    that.relayState.masterId = that.clientId
    that.socket.sendMessage('onBecomeLeaderIntent', { 'clientId': that.clientId, 'netIps': Array.from(that.relayState.netState.ips) })
  }

  const ensureNotLocal = (address) => {
    if (address.endsWith(".local")) {
      return false
    }
    if (address.includes(":")) {
      return false
    }
    return true
  }

  const closeEnough = (clientAddresses, masterAddresses, bitsToConsider) => {
    let _closeEnough = (clientAddress, masterAddress, bitsToConsider) => {
      bitsToConsider = bitsToConsider - 24
      if (bitsToConsider <= 0) {
        return false
      }
      let clientParts = clientAddress.split(".")
      let masterParts = masterAddress.split(".")
      for (let i = 0; i < 3; i++) {
        if (clientParts[i] !== masterParts[i]) {
          return false
        }
      }
      let clientNum = parseInt(clientParts[3]).toString(2)
      let masterNum = parseInt(masterParts[3]).toString(2)
      for (let i = 0; i < bitsToConsider; i++) {
        if (clientNum[i] !== masterNum[i]) {
          return false
        }
      }
      return true
    }

    for (let clientAddress of clientAddresses) {
      for (let masterAddress of masterAddresses) {
        if (_closeEnough(clientAddress, masterAddress, bitsToConsider)) {
          return true
        }
      }
    }
    return false
  }

  const createNewRTCPeerConn = (targetId, streamId) => {
    let conn = new RTCPeerConnection(
      {
        'iceServers': STUN_SERVERS.concat(TURN_SERVERS),
        'bundlePolicy': 'max-compat',
        'iceCandidatePoolSize': 2,
        'rtcpMuxPolicy': 'negotiate',
      }
    )
    conn.onicecandidateerror = errorEvent => {
      console.error(errorEvent)
    }
    conn.oniceconnectionstatechange = change => {
      console.error(change)
    }
    conn.onicecandidate = iceEvent => {
      if (iceEvent.candidate) {
        console.log(`Send ice candidate to ${targetId}:${streamId}`)
        that.socket.sendMessage(
          'sendIceCandidate',
          {
            'sourceId': that.clientId,
            'targetId': targetId,
            'streamId': streamId,
            'iceCandidate': iceEvent.candidate
          }
        )
      }
    }
    return conn
  }

  const onReceiveBecomeLeaderIntent = (event) => {
    event = event.args[0]
    if (event.clientId === that.clientId) {
      return
    }
    let ips = Array.from(that.relayState.netState.ips)
    if (!closeEnough(ips, event.netIps, 25)) {
      log.warning(`Nets do not match: master's net is ${event.netIps}, client's is ${ips}`)
      return
    }
    console.log("Receive become leader intent:", event)
    if (that.relayState.masterId !== event.clientId) {
      reinitRelayState()
      that.relayState.masterId = event.clientId
    }
    function handleStream(stream) {
      if (that.localStreams.has(stream.getID())) {
        return
      }

      if (that.relayState.replicaState.streams.has(stream.getID())) {
        return
      }

      let conn = createNewRTCPeerConn(event.clientId, stream.getID())
      that.relayState.replicaState.streams.add(stream.getID(), conn)

      conn.ontrack = (event) => {
        let track = event.track
        track.onunmute = (ev) => {
          console.log('On track event', ev)
          let containerId = `stream${stream.getID()}`
          let videoContainer = document.getElementById(containerId)
          if (videoContainer === null) {
            return
          }
          let newStream = event.streams[0]
          console.log("Substitute", containerId, "with", newStream)
          videoContainer.srcObject = newStream

        }
      }
      conn.onconnectionstatechange = (ev) => {
        if (conn.iceConnectionState === 'disconnected') {
          that.relayState.masterId = undefined
          return
        }
        if (conn.iceConnectionState === 'connected') {
          let mcuStream = that.remoteStreams.get(stream.getID())
          if (mcuStream === undefined) {
            return
          }
          let pc = mcuStream.pc.peerConnection
          if (pc !== undefined) {
            console.warn(`Close stream ${stream.getID()}`)
            pc.close()
          }
          let pair = conn.getReceivers()[0].transport.iceTransport.getSelectedCandidatePair()
          let localPair = pair.local
          fetch("https://collector.webrtc-thesis.ru/connections", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ts: new Date().toISOString(),
              clientId: event.clientId,
              edge: {
                targetId: that.clientId,
                type_: "add",
                candidateAddr: `${localPair.address}:${localPair.port}`
              }
            })
          })
            .then(() => { })
            .catch((err) => console.error(err))
        }
      }
      conn.createOffer({ 'offerToReceiveVideo': true })
        .then((offer) => {
          conn.setLocalDescription(offer)
            .then(() => {
              that.socket.sendMessage(
                'sendRelayRequest',
                {
                  'streamId': stream.getID(),
                  'consumerId': that.clientId,
                  'offer': conn.localDescription,
                }
              )
            })
            .catch((err) => {
              console.error(err)
              console.warn(localDescription)
              console.warn(conn)
              console.warn(offer)
              console.warn(outerConn)
            })
        })
        .catch((err) => {
          console.error(err)
          console.warn(conn)
        })
    }
    that.remoteStreams.forEach((stream) => {
      handleStream(stream)
    })
  }

  const onReceiveRelayRequest = (event) => {
    event = event.args[0]
    if (that.clientId !== that.relayState.masterId) {
      return
    }
    console.log("On receive relay request", event)
    let clients = that.relayState.masterState.clients
    if (!clients.has(event.consumerId)) {
      clients.add(event.consumerId, ErizoMap())
    }
    let stream = undefined
    that.remoteStreams.forEach(remoteStream => {
      if (remoteStream.getID() === event.streamId) {
        stream = remoteStream
      }
    })
    that.localStreams.forEach(localStream => {
      if (localStream.getID() === event.streamId) {
        stream = localStream
      }
    })
    if (stream === undefined) {
      console.error("Cannot find stream for id", event.streamId)
      return
    }

    let conn = createNewRTCPeerConn(event.consumerId, event.streamId)
    clients.get(event.consumerId).add(event.streamId, conn)

    stream.pc.streamsMap.forEach(str => {
      str = str.stream
      console.log(str)
      for (let track of str.getTracks()) {
        console.log(`Add track to ${event.consumerId}:${event.streamId}`, track)
        conn.addTrack(track, str)
      }
    })
    conn.setRemoteDescription(event.offer)
      .then(() => { })
      .catch((err) => console.error(err))
    conn.createAnswer().then(answer => {
      conn.setLocalDescription(answer)
      that.socket.sendMessage(
        'sendRelayResponse',
        {
          'consumerId': event.consumerId,
          'streamId': event.streamId,
          'answer': answer,
        }
      )
    })
  }

  const onReceiveRelayResponse = (event) => {
    event = event.args[0]
    if (event.consumerId !== that.clientId) {
      return
    }
    console.log("Relay response", event)
    let conn = that.relayState.replicaState.streams.get(event.streamId)
    if (conn.signalingState === "stable") {
      return
    }
    conn.setRemoteDescription(new RTCSessionDescription(event.answer))
      .then(() => { })
      .catch((err) => console.error(err))
  }

  const onReceiveIceCandidate = (event) => {
    event = event.args[0]
    if (that.clientId === event.sourceId) {
      return
    }
    if (that.clientId !== event.targetId) {
      return
    }
    console.log("On receive ice candidate", event)
    let iceCandidate = new RTCIceCandidate(event.iceCandidate)
    let conn = undefined
    if (that.relayState.masterId === that.clientId) {
      let clientStreams = that.relayState.masterState.clients.get(event.sourceId)
      if (clientStreams === undefined) {
        console.error("Cannot find client", event.sourceId)
        return
      }
      conn = clientStreams.get(event.streamId)
    } else {
      conn = that.relayState.replicaState.streams.get(event.streamId)
    }
    if (conn === undefined) {
      console.error("Cannot find stream for client", event.sourceId, event.streamId)
    }
    conn.addIceCandidate(iceCandidate)
      .then(() => { console.info(`Ice candidate applied`) })
      .catch((err) => console.error(err))
  }

  const setFoundAddresses = () => {
    let element = document.getElementById('foundAddresses')
    if (element === null) {
      return
    }
    let ips = that.relayState
    if (ips === undefined) {
      return
    }
    ips = ips.netState
    if (ips === undefined) {
      return
    }
    ips = ips.ips
    if (ips === undefined) {
      ips = null
    }
    element.innerText = JSON.stringify(Array.from(ips))
  }

  const setCurrentID = () => {
    let currentID = document.getElementById("currentID")
    if (currentID !== null) {
      currentID.innerText = that.clientId
    }

  }

  const setCurrentMaster = () => {
    let state = that.relayState
    let currentMaster = document.getElementById("currentMaster")
    if (currentMaster !== null) {
      currentMaster.innerText = state.masterId
    }
  }

  const setCurrentRemoteCandidate = () => {
    let streamList = new Set();
    for (let stream of that.remoteStreams.keys()) {
      streamList.add(stream)
    }
    for (let streamId of Array.from(streamList)) {
      let container = document.getElementById(`candidate_${streamId}`)
      if (container === null) {
        continue
      }
      let found = false
      let stream = undefined
      if (that.relayState.masterId === undefined || that.relayState.masterId === that.clientId) {
        stream = that.remoteStreams.get(streamId).pc.peerConnection
      } else {
        let replicaState = that.relayState.replicaState
        if (replicaState !== undefined) {
          stream = replicaState.streams.get(streamId)
          if (
            stream === undefined ||
            stream.getReceivers()[0].transport === null ||
            stream.getReceivers()[0].transport.iceTransport.getSelectedCandidatePair() === null
          ) {
            stream = that.remoteStreams.get(streamId).pc.peerConnection
          }
        }
      }
      if (stream === undefined) {
        continue
      }
      let pair = stream.getReceivers()[0].transport.iceTransport.getSelectedCandidatePair()
      if (pair === null) {
        pair = {
          "remote": {
            "address": undefined,
            "port": undefined,
          }
        }
      }
      container.innerText = `remote: ${pair.remote.address}:${pair.remote.port}`

      if (found) {
        return
      }
    }
  }

  const discoverRoomIP = () => {
    let conn = new RTCPeerConnection(
      {
        'iceServers': STUN_SERVERS.concat([])
      }
    )
    that.relayState.netState.conn = conn
    conn.onicecandidate = (event) => {
      if (!event.candidate) {
        return
      }
      let notLocalAddr = ensureNotLocal(event.candidate.address)
      console.log("Address:", event.candidate.address, "result: ", notLocalAddr)
      if (notLocalAddr) {
        that.relayState.netState.ips.add(event.candidate.address)
        console.log("Addresses:", that.relayState.netState.ips)

      }
    }
    conn.createOffer({ 'offerToReceiveVideo': true }).then((offer) => {
      conn.setLocalDescription(offer)
    })
  }

  const notifyAboutMaster = () => {
    if (that.clientId !== that.relayState.masterId) {
      return
    }
    onBecomeLeaderIntent()
  }

  const tryBecomeMaster = () => {
    if (that.relayState.masterId !== undefined) {
      return
    }
    onBecomeLeaderIntent()
  }

  let prevCons = { 'ts': undefined }

  const pushStats = async () => {
    let cons = {}
    that.localStreams.forEach((stream) => {
      if (stream.pc !== undefined) {
        cons[stream.stream.id] = stream.pc.peerConnection.getStats()
      }
    })
    that.remoteStreams.forEach((stream) => {
      if (stream.local !== true) {
        cons[stream.stream.id] = stream.pc.peerConnection.getStats()
      }
    })
    if (that.clientId === that.relayState.masterId) {
      for (let clientId of that.relayState.masterState.clients.keys()) {
        let streams = that.relayState.masterState.clients.get(clientId)
        for (let streamId of streams.keys()) {
          let stream = streams.get(streamId)
          cons[streamId] = stream.getStats()
        }
      }
    } else if (that.relayState.replicaState !== undefined) {
      for (let streamId of that.relayState.replicaState.streams.keys()) {
        let stream = that.relayState.replicaState.streams.get(streamId)
        cons[streamId] = stream.getStats()
      }
    }

    let newStats = {
      'totalIn': 0,
      'totalOut': 0,
    }
    for (const [streamId, promise] of Object.entries(cons)) {
      let prevIn = 0
      let prevOut = 0
      if (prevCons[streamId] === undefined) {
        prevCons[streamId] = {
          'bytesReceived': undefined,
          'bytesSent': undefined
        }
      }
      let v = prevCons[streamId].bytesReceived
      if (v !== undefined) {
        prevIn = v
      }
      v = prevCons[streamId].bytesSent
      if (v !== undefined) {
        prevOut = v
      }
      report = await promise
      for (let entry of report.values()) {
        if (entry.type === "inbound-rtp") {
          if (entry.bytesReceived !== undefined) {
            newStats.totalIn += entry.bytesReceived - prevIn
            prevCons[streamId].bytesReceived = entry.bytesReceived
          }
        }
        if (entry.type === "outbound-rtp") {
          if (entry.bytesSent !== undefined) {
            newStats.totalOut += entry.bytesSent - prevOut
            prevCons[streamId].bytesSent = entry.bytesSent
          }
        }
      }
    }

    let ts = new Date()
    let timeElapsed = 3
    if (prevCons.ts !== undefined) {
      timeElapsed = Math.abs(ts - prevCons.ts) / 1000
    }
    prevCons.ts = ts
    newStats.totalIn /= timeElapsed
    newStats.totalIn /= 128
    newStats.totalOut /= timeElapsed
    newStats.totalOut /= 128

    fetch("https://collector.webrtc-thesis.ru/metrics", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ts: new Date().toISOString(),
        clientId: that.clientId,
        metric_name: 'NETIN',
        metric_value: newStats.totalIn,
      })
    })
      .then(() => { })
      .catch((err) => console.error(err))

    fetch("https://collector.webrtc-thesis.ru/metrics", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ts: new Date().toISOString(),
        clientId: that.clientId,
        metric_name: 'NETOUT',
        metric_value: newStats.totalOut,
      }),
    })
      .then(() => { })
      .catch((err) => console.error(err))
  }

  that.on('room-disconnected', clearAll);
  that.on('onBecomeLeaderIntent', onBecomeLeaderIntent)
  that.on('connection-failed', onConnectionFailed)

  socket.on('leaderIntent', onReceiveBecomeLeaderIntent)
  socket.on('relayRequest', onReceiveRelayRequest)
  socket.on('relayResponse', onReceiveRelayResponse)
  socket.on('iceCandidate', onReceiveIceCandidate)
  socket.on('onAddStream', socketEventToArgs.bind(null, socketOnAddStream));
  socket.on('stream_message_erizo', socketEventToArgs.bind(null, socketOnStreamMessageFromErizo));
  socket.on('stream_message_p2p', socketEventToArgs.bind(null, socketOnStreamMessageFromP2P));
  socket.on('connection_message_erizo', socketEventToArgs.bind(null, socketOnConnectionMessageFromErizo));
  socket.on('publish_me', socketEventToArgs.bind(null, socketOnPublishMe));
  socket.on('unpublish_me', socketEventToArgs.bind(null, socketOnUnpublishMe));
  socket.on('onBandwidthAlert', socketEventToArgs.bind(null, socketOnBandwidthAlert));
  socket.on('onDataStream', socketEventToArgs.bind(null, socketOnDataStream));
  socket.on('onUpdateAttributeStream', socketEventToArgs.bind(null, socketOnUpdateAttributeStream));
  socket.on('onRemoveStream', socketEventToArgs.bind(null, socketOnRemoveStream));
  socket.on('disconnect', socketEventToArgs.bind(null, socketOnDisconnect));
  socket.on('reconnecting', socketEventToArgs.bind(null, socketOnReconnecting));
  socket.on('reconnected', socketEventToArgs.bind(null, socketOnReconnected));
  socket.on('connection_failed', socketEventToArgs.bind(null, socketOnICEConnectionFailed));
  socket.on('error', socketEventToArgs.bind(null, socketOnError));
  discoverRoomIP()

  setInterval(notifyAboutMaster, 5000)
  // setInterval(tryBecomeMaster, 15000)
  setInterval(() => {
    setFoundAddresses()
    setCurrentID()
    setCurrentMaster()
    setCurrentRemoteCandidate()
  }, 1000)

  setInterval(async () => {
    await pushStats()
  }, 3000)
  return that;
};

export default Room;
