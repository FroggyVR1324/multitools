
(function (Scratch) {
    'use strict';

    if (!Scratch.extensions.unsandboxed) {
        throw new Error('MultiTools must be loaded without the sandbox.');
    }

    class MultiTools {
        constructor() {
            this.runtime = Scratch.vm.runtime;

            this.peer = null;
            this.connections = new Map();
            this.players = new Set();
            this.positions = new Map();

            this.roomID = '';
            this.status = 'Disconnected';
            this.myPlayerID = '';

            this.lastMessage = '';
            this.lastJoinedPlayerID = '';
            this.lastPositionPlayerID = '';

            this.syncTarget = null;
            this.syncTimer = null;
            this.lastSentPosition = null;

            this.peerJSLoading = null;
        }
        
        getInfo() {
            return {
                id: 'multitools',
                name: 'MultiTools',
                color1: '#5865F2',
                color2: '#4752C4',
                color3: '#7289DA',

                blocks: [
                    {
                        opcode: 'createRoom',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'create multiplayer room with [ID]',
                        arguments: {
                            ID: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'my-room'
                            }
                        }
                    },
                    {
                        opcode: 'joinRoom',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'join room [ID]',
                        arguments: {
                            ID: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'my-room'
                            }
                        }
                    },
                    {
                        opcode: 'sendMessage',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'send [MESSAGE] to all players',
                        arguments: {
                            MESSAGE: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'Hello!'
                            }
                        }
                    },
                    {
                        opcode: 'enablePositionSync',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'enable automatic position sync'
                    },
                    {
                        opcode: 'disablePositionSync',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'disable automatic position sync'
                    },
                    {
                        opcode: 'disconnect',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'disconnect'
                    },

                    {
                        opcode: 'whenPlayerJoins',
                       blockType: Scratch.BlockType.EVENT,
                        text: 'when player joins'
                    },
                    {
                        opcode: 'whenMessageReceived',
                        blockType: Scratch.BlockType.EVENT,
                        text: 'when message received'
                    },
                    {
                        opcode: 'whenPlayerPositionUpdates',
                        blockType: Scratch.BlockType.EVENT,
                        text: 'when player position updates'
                    },

                    {
                        opcode: 'getMessage',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'received message'
                    },
                    {
                        opcode: 'getStatus',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'connection status'
                    },
                    {
                        opcode: 'getRoomID',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'room ID'
                    },
                    {
                        opcode: 'getMyPlayerID',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'my player ID'
                    },
                    {
                        opcode: 'getPlayerCount',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'player count'
                    },
                    {
                        opcode: 'getLastJoinedPlayerID',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'last joined player ID'
                    },
                    {
                        opcode: 'getLastPositionPlayerID',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'last updated player ID'
                    },
                    {
                        opcode: 'getPlayerX',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'player [ID] x position',
                        arguments: {
                            ID: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'player ID'
                            }
                        }
                    },
                    {
                        opcode: 'getPlayerY',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'player [ID] y position',
                        arguments: {
                            ID: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'player ID'
                            }
                        }
                    }
                ]
            };
        }

        loadPeerJS() {
            if (window.Peer) return Promise.resolve();

            if (this.peerJSLoading) return this.peerJSLoading;

            this.peerJSLoading = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js';

                script.onload = () => {
                    if (window.Peer) {
                        resolve();
                    } else {
                        reject(new Error('PeerJS failed to load.'));
                    }
                };

                script.onerror = () => {
                    this.peerJSLoading = null;
                    reject(new Error('Could not load PeerJS.'));
                };

                document.head.appendChild(script);
            });

            return this.peerJSLoading;
        }

        async createRoom(args) {
            await this.disconnect();

            try {
                await this.loadPeerJS();

                this.roomID = String(args.ID).trim();
                if (!this.roomID) throw new Error('Enter a room ID.');

                this.status = 'Connecting...';

                const peerID = 'mt-room-' + this.roomID;

                this.peer = new window.Peer(peerID, {
                    debug: 1
                });

                this.peer.on('open', id => {
                    this.myPlayerID = id;
                    this.players.add(id);
                    this.status = 'Hosting';
                });

                this.peer.on('connection', connection => {
                    this.handleHostConnection(connection);
                });

                this.peer.on('error', error => {
                    this.status = 'Error: ' + error.type;
                });

                this.peer.on('disconnected', () => {
                    this.status = 'Disconnected';
                });
            } catch (error) {
                this.status = 'Error: ' + error.message;
            }
        }

        async joinRoom(args) {
            await this.disconnect();

            try {
                await this.loadPeerJS();

                this.roomID = String(args.ID).trim();
                if (!this.roomID) throw new Error('Enter a room ID.');

                this.status = 'Connecting...';

                this.peer = new window.Peer(undefined, {
                    debug: 1
                });

                this.peer.on('open', id => {
                    this.myPlayerID = id;

                    const connection = this.peer.connect(
                        'mt-room-' + this.roomID,
                        { reliable: true }
                    );

                    this.connections.set('Host', connection);

                    connection.on('open', () => {
                        this.status = 'Connected';
                    });

                    connection.on('data', data => {
                        this.handleData(data, 'Host');
                    });

                    connection.on('close', () => {
                        this.connections.delete('Host');
                        this.status = 'Disconnected';
                    });

                    connection.on('error', error => {
                        this.status = 'Error: ' + error;
                    });
                });

                this.peer.on('error', error => {
                    this.status = 'Error: ' + error.type;
                });
            } catch (error) {
                this.status = 'Error: ' + error.message;
            }
        }

        handleHostConnection(connection) {
            connection.on('open', () => {
                const playerID = connection.peer;

                this.connections.set(playerID, connection);
                this.players.add(playerID);

                connection.send({
                    type: 'welcome',
                    hostID: this.myPlayerID,
                    players: Array.from(this.players),
                    positions: Array.from(this.positions.entries())
                });

                this.lastJoinedPlayerID = playerID;
                this.runtime.startHats('multitools_whenPlayerJoins');

                this.broadcast({
                    type: 'playerJoined',
                    playerID: playerID
                }, playerID);
            });

            connection.on('data', data => {
                this.handleData(data, connection.peer);
            });

            connection.on('close', () => {
                const playerID = connection.peer;

                this.connections.delete(playerID);
                this.players.delete(playerID);
                this.positions.delete(playerID);

                this.broadcast({
                    type: 'playerLeft',
                    playerID: playerID
                });

                this.broadcast({
                    type: 'removePosition',
                    playerID: playerID
                });
            });
        }

        handleData(data, senderID) {
            if (!data || typeof data !== 'object') return;

            if (data.type === 'welcome') {
                this.players = new Set(data.players || []);
                this.players.add(this.myPlayerID);

                if (data.hostID) this.players.add(data.hostID);

                if (Array.isArray(data.positions)) {
                    data.positions.forEach(entry => {
                        if (Array.isArray(entry) && entry.length === 2) {
                            const id = entry[0];
                            const position = entry[1];

                            this.receivePosition(id, position.x, position.y);
                        }
                    });
                }

                return;
            }

            if (data.type === 'message') {
                this.lastMessage = String(data.message);

                this.runtime.startHats(
                    'multitools_whenMessageReceived'
                );

                // The host relays client messages to the other clients.
                if (this.status === 'Hosting') {
                    this.broadcast(data, senderID);
                }

                return;
            }

            if (data.type === 'position') {
                const playerID = senderID === 'Host'
                    ? data.playerID
                    : senderID;

                this.receivePosition(playerID, data.x, data.y);

                // Relay client positions through the host.
                if (this.status === 'Hosting') {
                    this.broadcast({
                        type: 'position',
                        playerID: playerID,
                        x: data.x,
                        y: data.y
                    }, senderID);
                }

                return;
            }

            if (data.type === 'playerJoined') {
                this.players.add(data.playerID);
                this.lastJoinedPlayerID = data.playerID;

                this.runtime.startHats(
                    'multitools_whenPlayerJoins'
                );

                return;
            }

            if (data.type === 'playerLeft') {
                this.players.delete(data.playerID);
                this.positions.delete(data.playerID);
                return;
            }

            if (data.type === 'removePosition') {
                this.positions.delete(data.playerID);
            }
        }

        receivePosition(playerID, x, y) {
            if (!playerID) return;
            if (!Number.isFinite(Number(x)) ||
                !Number.isFinite(Number(y))) return;

            const position = {
                x: Number(x),
                y: Number(y)
            };

            this.positions.set(playerID, position);
            this.players.add(playerID);
            this.lastPositionPlayerID = playerID;

            this.runtime.startHats(
                'multitools_whenPlayerPositionUpdates'
            );
        }

        broadcast(data, exceptID) {
            for (const [playerID, connection] of this.connections) {
                if (playerID === exceptID) continue;

                if (connection.open) {
                    connection.send(data);
                }
            }
        }

        sendMessage(args) {
            const data = {
                type: 'message',
                message: String(args.MESSAGE)
            };

            if (this.status === 'Hosting') {
                this.lastMessage = data.message;

                this.runtime.startHats(
                    'multitools_whenMessageReceived'
                );

                this.broadcast(data);
            } else {
                const host = this.connections.get('Host');

                if (host && host.open) {
                    host.send(data);
                }
            }
        }

        enablePositionSync(args, util) {
            if (!util || !util.target || util.target.isStage) return;

            this.syncTarget = util.target;

            if (this.syncTimer) {
                clearInterval(this.syncTimer);
            }

            // Send the sprite's position 20 times per second.
            this.syncTimer = setInterval(() => {
                this.sendCurrentPosition();
            }, 50);

            this.sendCurrentPosition();
        }

        disablePositionSync() {
            if (this.syncTimer) {
                clearInterval(this.syncTimer);
                this.syncTimer = null;
            }

            this.syncTarget = null;
            this.lastSentPosition = null;
        }

        sendCurrentPosition() {
            if (!this.syncTarget || !this.myPlayerID) return;

            if (this.status !== 'Hosting' &&
                this.status !== 'Connected') return;

            const x = Number(this.syncTarget.x);
            const y = Number(this.syncTarget.y);

            if (!Number.isFinite(x) || !Number.isFinite(y)) return;

            // Don't send unchanged coordinates.
            if (
                this.lastSentPosition &&
                this.lastSentPosition.x === x &&
                this.lastSentPosition.y === y
            ) {
                return;
            }

            this.lastSentPosition = { x, y };

            const data = {
                type: 'position',
                playerID: this.myPlayerID,
                x: x,
                y: y
            };

            if (this.status === 'Hosting') {
                this.receivePosition(this.myPlayerID, x, y);
                this.broadcast(data);
            } else {
                const host = this.connections.get('Host');

                if (host && host.open) {
                    host.send(data);
                }
            }
        }

        disconnect() {
            this.disablePositionSync();

            for (const connection of this.connections.values()) {
                try {
                    connection.close();
                } catch (error) {}
            }

            this.connections.clear();
            this.players.clear();
            this.positions.clear();

            if (this.peer) {
                try {
                    this.peer.destroy();
                } catch (error) {}
            }

            this.peer = null;
            this.roomID = '';
            this.myPlayerID = '';
            this.status = 'Disconnected';

            this.lastPositionPlayerID = '';
            this.lastJoinedPlayerID = '';
        }

        getMessage() {
            return this.lastMessage;
        }

        getStatus() {
            return this.status;
        }

        getRoomID() {
            return this.roomID;
        }

        getMyPlayerID() {
            return this.myPlayerID;
        }

        getPlayerCount() {
            return this.players.size;
        }

        getLastJoinedPlayerID() {
            return this.lastJoinedPlayerID;
        }

        getLastPositionPlayerID() {
            return this.lastPositionPlayerID;
        }

        getPlayerX(args) {
            const position = this.positions.get(String(args.ID));
            return position ? position.x : 0;
        }

        getPlayerY(args) {
            const position = this.positions.get(String(args.ID));
            return position ? position.y : 0;
        }
    }

    Scratch.extensions.register(new MultiTools());
})(Scratch);
