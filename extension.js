
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
            this.remoteDrawables = new Map();
            this.remoteSkinIds = new Map();
            this.costumes = new Map();

            this.roomID = '';
            this.status = 'Disconnected';
            this.peerID = '';
            this.myPlayerID = '';
            this.peerToPlayerID = new Map();
            this.playerIDToPeer = new Map();

            this.lastMessage = '';
            this.lastPrivateMessage = '';
            this.lastPrivateMessageSender = '';
            this.lastJoinedPlayerID = '';
            this.lastPositionPlayerID = '';

            this.syncTarget = null;
            this.syncTimer = null;
            this.lastSentPosition = null;
            this.lastSentCostumeKey = null;
            this.showToOthers = true;
            this.costumeChangeHook = null;
            this.soloLobbyTimer = null;
            this.migrationTimer = null;
            this.migrationInProgress = false;
            this.isDisconnecting = false;

            this.dashboardElement = null;
            this.dashboardVisible = false;
            this.maxPlayers = 8;
            this.roomLocked = false;

            // Each named list stores a separate array for every player ID.
            this.playerLists = new Map();

            // Each named player variable stores a value for every player ID.
            this.playerVariables = new Map();

            // WebRTC transport counters (bytes) and one-second rate samples.
            this.bandwidthSent = 0;
            this.bandwidthReceived = 0;
            this.uploadRate = 0;
            this.downloadRate = 0;
            this.bandwidthBaselines = new Map();
            this.bandwidthTimer = null;
            this.bandwidthSampling = false;

            // Round-trip latency samples, keyed by player ID.
            this.pingValues = new Map();
            this.pendingPings = new Map();
            this.pingTimer = null;
            this.pingSequence = 0;

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
                        opcode: 'sendPrivateMessage',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'send [MESSAGE] privately to player [ID]',
                        arguments: {
                            MESSAGE: {type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!'},
                            ID: {type: Scratch.ArgumentType.NUMBER, defaultValue: 2}
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
                        opcode: 'hideMeForEveryoneElse',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'hide me for everyone else'
                    },
                    {
                        opcode: 'showMeForEveryoneElse',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'show me for everyone else'
                    },
                    {
                        opcode: 'disconnect',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'disconnect'
                    },
                    {
                        opcode: 'showDashboard',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'show dashboard'
                    },
                    {
                        opcode: 'hideDashboard',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'hide dashboard'
                    },
                    {
                        opcode: 'setMyPlayerVariable',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'set my variable [NAME] to [VALUE]',
                        arguments: {
                            NAME: {type: Scratch.ArgumentType.STRING, defaultValue: 'health'},
                            VALUE: {type: Scratch.ArgumentType.STRING, defaultValue: '100'}
                        }
                    },
                    {
                        opcode: 'getPlayerVariable',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'player [PLAYER] variable [NAME]',
                        arguments: {
                            PLAYER: {type: Scratch.ArgumentType.NUMBER, defaultValue: 1},
                            NAME: {type: Scratch.ArgumentType.STRING, defaultValue: 'health'}
                        }
                    },
                    {
                        opcode: 'deleteMyPlayerVariable',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'delete my variable [NAME]',
                        arguments: {
                            NAME: {type: Scratch.ArgumentType.STRING, defaultValue: 'health'}
                        }
                    },
                    {
                        opcode: 'createPlayerList',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'create player list with name [LIST]',
                        arguments: {
                            LIST: {type: Scratch.ArgumentType.STRING, defaultValue: 'Inventory'}
                        }
                    },
                    {
                        opcode: 'addToPlayerList',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'add [ITEM] to player list [LIST]',
                        arguments: {
                            ITEM: {type: Scratch.ArgumentType.STRING, defaultValue: 'Sword'},
                            LIST: {type: Scratch.ArgumentType.STRING, defaultValue: 'Inventory'}
                        }
                    },
                    {
                        opcode: 'removeFromPlayerList',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'remove [ITEM] from player list [LIST]',
                        arguments: {
                            ITEM: {type: Scratch.ArgumentType.STRING, defaultValue: 'Sword'},
                            LIST: {type: Scratch.ArgumentType.STRING, defaultValue: 'Inventory'}
                        }
                    },
                    {
                        opcode: 'replacePlayerListItem',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'replace item [INDEX] of player list [LIST] with [ITEM]',
                        arguments: {
                            INDEX: {type: Scratch.ArgumentType.NUMBER, defaultValue: 1},
                            LIST: {type: Scratch.ArgumentType.STRING, defaultValue: 'Inventory'},
                            ITEM: {type: Scratch.ArgumentType.STRING, defaultValue: 'Shield'}
                        }
                    },
                    {
                        opcode: 'getPlayerListItem',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'item [INDEX] of player list [LIST]',
                        arguments: {
                            INDEX: {type: Scratch.ArgumentType.NUMBER, defaultValue: 1},
                            LIST: {type: Scratch.ArgumentType.STRING, defaultValue: 'Inventory'}
                        }
                    },
                    {
                        opcode: 'getPlayerListLength',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'length of player list [LIST]',
                        arguments: {
                            LIST: {type: Scratch.ArgumentType.STRING, defaultValue: 'Inventory'}
                        }
                    },
                    {
                        opcode: 'getPlayerListContents',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'contents of player list [LIST]',
                        arguments: {
                            LIST: {type: Scratch.ArgumentType.STRING, defaultValue: 'Inventory'}
                        }
                    },
                    {
                        opcode: 'getOtherPlayerList',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'player [PLAYER] list [LIST]',
                        arguments: {
                            PLAYER: {type: Scratch.ArgumentType.NUMBER, defaultValue: 2},
                            LIST: {type: Scratch.ArgumentType.STRING, defaultValue: 'Inventory'}
                        }
                    },
                    {
                        opcode: 'getBandwidthSent',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'total bytes sent'
                    },
                    {
                        opcode: 'getBandwidthReceived',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'total bytes received'
                    },
                    {
                        opcode: 'getUploadRate',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'upload speed (KB/s)'
                    },
                    {
                        opcode: 'getDownloadRate',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'download speed (KB/s)'
                    },

                    {
                        opcode: 'getPingToHost',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'ping to host (ms)'
                    },
                    {
                        opcode: 'getPlayerPing',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'player [ID] ping (ms)',
                        arguments: {
                            ID: {type: Scratch.ArgumentType.NUMBER, defaultValue: 2}
                        }
                    },
                    {
                        opcode: 'whenPlayerJoins',
                        blockType: Scratch.BlockType.EVENT,
                        text: 'when player joins',
                        isEdgeActivated: false
                    },
                    {
                        opcode: 'whenMessageReceived',
                        blockType: Scratch.BlockType.EVENT,
                        text: 'when message received',
                        isEdgeActivated: false
                    },
                    {
                        opcode: 'whenPrivateMessageReceived',
                        blockType: Scratch.BlockType.EVENT,
                        text: 'when private message received',
                        isEdgeActivated: false
                    },
                    {
                        opcode: 'whenPlayerPositionUpdates',
                        blockType: Scratch.BlockType.EVENT,
                        text: 'when player position updates',
                        isEdgeActivated: false
                    },
                    {
                        opcode: 'getMessage',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'received message'
                    },
                    {
                        opcode: 'getPrivateMessage',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'received private message'
                    },
                    {
                        opcode: 'getPrivateMessageSender',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'private message sender player ID'
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
                    },
                    {
                        opcode: 'getBackdropName',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'backdrop name of [ID]',
                        arguments: {
                            ID: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'player ID'
                            }
                        }
                    },
                    {
                        opcode: 'getBackdropNumber',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'backdrop number of [ID]',
                        arguments: {
                            ID: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'player ID'
                            }
                        }
                    },
                    {
                        opcode: 'getPlayerDirection',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'player [ID] direction',
                        arguments: {
                            ID: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'player ID'
                            }
                        }
                    },
                    {
                        opcode: 'getPlayerSize',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'player [ID] size',
                        arguments: {
                            ID: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'player ID'
                            }
                        }
                    },
                    {
                        opcode: 'getPlayerVisible',
                        blockType: Scratch.BlockType.BOOLEAN,
                        text: 'player [ID] sprite is visible?',
                        arguments: {
                            ID: {
                                type: Scratch.ArgumentType.STRING,
                                defaultValue: 'player ID'
                            }
                        }
                    },
                    {
                        opcode: 'getPlayerVisibleToOthers',
                        blockType: Scratch.BlockType.BOOLEAN,
                        text: 'player [ID] visible to everyone else?',
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
            this.isDisconnecting = false;

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
                    this.peerID = id;
                    this.myPlayerID = 1;
                    this.players = new Set([1]);
                    this.peerToPlayerID.clear();
                    this.playerIDToPeer.clear();
                    this.peerToPlayerID.set(id, 1);
                    this.playerIDToPeer.set(1, id);
                    this.status = 'Hosting';
                    this.updateSoloLobbyTimer();
                    this.updateDashboard();
                    this.startBandwidthMonitor();
                    this.startPingMonitor();
                    this.sendCurrentCostume();
                });

                this.peer.on('connection', connection => {
                    this.handleHostConnection(connection);
                });

                this.peer.on('error', error => {
                    if (error.type === 'unavailable-id') {
                        this.status = 'Room already exists! Choose a different room ID.';
                    } else {
                        this.status = 'Error: ' + error.type;
                    }
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
            this.isDisconnecting = false;

            try {
                await this.loadPeerJS();

                this.roomID = String(args.ID).trim();
                if (!this.roomID) throw new Error('Enter a room ID.');

                this.status = 'Connecting...';

                this.peer = new window.Peer(undefined, {
                    debug: 1
                });

                this.peer.on('open', id => {
                    this.peerID = id;

                    const connection = this.peer.connect(
                        'mt-room-' + this.roomID,
                        { reliable: true }
                    );

                    this.connections.set('Host', connection);

                    connection.on('open', () => {
                        this.status = 'Connected';
                        this.startBandwidthMonitor();
                        this.startPingMonitor();
                        this.sendCurrentPosition();
                        this.sendCurrentCostume();
                    });

                    connection.on('data', data => {
                        this.handleData(data, 'Host');
                    });

                    connection.on('close', () => {
                        this.connections.delete('Host');
                        this.handleHostLost();
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

        handleHostLost() {
            if (this.isDisconnecting || this.migrationInProgress || !this.roomID || !this.peer) return;
            this.migrationInProgress = true;
            this.status = 'Host left — migrating room...';
            this.bandwidthBaselines.clear();
            this.pingValues.clear();
            this.pendingPings.clear();
            if (this.pingTimer) {
                clearInterval(this.pingTimer);
                this.pingTimer = null;
            }
            if (this.bandwidthTimer) {
                clearInterval(this.bandwidthTimer);
                this.bandwidthTimer = null;
            }
            this.bandwidthSampling = false;

            if (Number(this.myPlayerID) === 2) {
                this.promoteToHost();
            } else {
                this.reconnectToMigratedHost();
            }
            this.updateDashboard();
        }

        promoteToHost() {
            const roomID = this.roomID;
            try { this.peer.destroy(); } catch (error) {}
            this.peer = null;
            this.connections.clear();
            this.peerToPlayerID.clear();
            this.playerIDToPeer.clear();
            this.players = new Set([1]);
            this.myPlayerID = 1;
            this.peerID = '';
            this.positions.clear();
            this.costumes.clear();
            for (const perPlayer of this.playerLists.values()) {
                const ownItems = perPlayer.get(2) || [];
                perPlayer.clear();
                perPlayer.set(1, ownItems.slice());
            }
            for (const perPlayer of this.playerVariables.values()) {
                const ownValue = perPlayer.get(2);
                perPlayer.clear();
                if (ownValue !== undefined) perPlayer.set(1, ownValue);
            }
            this.status = 'Becoming host...';

            const attempt = () => {
                if (!this.migrationInProgress || this.roomID !== roomID) return;
                const peer = new window.Peer('mt-room-' + roomID, {debug: 1});
                this.peer = peer;
                peer.on('open', id => {
                    if (this.peer !== peer) return;
                    this.peerID = id;
                    this.status = 'Hosting';
                    this.migrationInProgress = false;
                    this.peerToPlayerID.set(id, 1);
                    this.playerIDToPeer.set(1, id);
                    this.startBandwidthMonitor();
                    this.startPingMonitor();
                    this.sendCurrentCostume();
                    this.updateSoloLobbyTimer();
                    this.updateDashboard();
                });
                peer.on('connection', connection => {
                    if (this.peer === peer) this.handleHostConnection(connection);
                });
                peer.on('error', error => {
                    if (this.peer !== peer || !this.migrationInProgress) return;
                    if (error && error.type === 'unavailable-id') {
                        try { peer.destroy(); } catch (destroyError) {}
                        if (this.peer === peer) this.peer = null;
                        this.migrationTimer = setTimeout(attempt, 700);
                    } else {
                        this.status = 'Host migration error: ' + (error && error.type || 'unknown');
                        this.migrationTimer = setTimeout(attempt, 1500);
                    }
                    this.updateDashboard();
                });
            };

            this.migrationTimer = setTimeout(attempt, 500);
        }

        reconnectToMigratedHost() {
            const roomID = this.roomID;
            const peer = this.peer;
            if (!peer || peer.destroyed) {
                this.status = 'Could not reconnect — host migration failed';
                this.migrationInProgress = false;
                return;
            }

            const attempt = () => {
                if (!this.migrationInProgress || this.roomID !== roomID || this.peer !== peer) return;
                if (peer.destroyed || !peer.open) {
                    this.migrationTimer = setTimeout(attempt, 700);
                    return;
                }
                const connection = peer.connect('mt-room-' + roomID, {
                    reliable: true,
                    metadata: {previousPlayerID: Number(this.myPlayerID)}
                });
                let settled = false;
                connection.on('open', () => {
                    settled = true;
                    this.connections.set('Host', connection);
                    this.status = 'Connected';
                    this.migrationInProgress = false;
                    this.startBandwidthMonitor();
                    this.startPingMonitor();
                    this.sendCurrentPosition();
                    this.sendCurrentCostume();
                    this.updateDashboard();
                });
                connection.on('data', data => this.handleData(data, 'Host'));
                connection.on('close', () => {
                    if (this.connections.get('Host') === connection) this.connections.delete('Host');
                    if (!this.migrationInProgress && this.roomID === roomID) {
                        this.migrationInProgress = true;
                        this.reconnectToMigratedHost();
                    }
                });
                connection.on('error', () => {
                    if (!settled && this.migrationInProgress) {
                        this.migrationTimer = setTimeout(attempt, 700);
                    }
                });
                this.migrationTimer = setTimeout(() => {
                    if (!settled && this.migrationInProgress) {
                        try { connection.close(); } catch (error) {}
                        attempt();
                    }
                }, 1200);
            };

            this.migrationTimer = setTimeout(attempt, 700);
        }

        handleHostConnection(connection) {
            connection.on('open', () => {
                if (this.roomLocked || this.players.size >= this.maxPlayers) {
                    if (connection.open) {
                        connection.send({
                            type: this.roomLocked ? 'serverLocked' : 'serverFull'
                        });
                        setTimeout(() => connection.close(), 100);
                    }
                    return;
                }

                const peerID = connection.peer;
                const requestedPlayerID = Number(connection.metadata && connection.metadata.previousPlayerID);
                const preferredPlayerID = requestedPlayerID > 2 ? requestedPlayerID - 1 : 0;
                const playerID = preferredPlayerID > 1 && !this.playerIDToPeer.has(preferredPlayerID)
                    ? preferredPlayerID
                    : this.getNextPlayerID();

                this.connections.set(peerID, connection);
                this.peerToPlayerID.set(peerID, playerID);
                this.playerIDToPeer.set(playerID, peerID);
                this.players.add(playerID);
                for (const perPlayer of this.playerLists.values()) {
                    perPlayer.set(playerID, []);
                }
                this.updateSoloLobbyTimer();
                this.updateDashboard();

                connection.send({
                    type: 'welcome',
                    playerID: playerID,
                    hostID: 1,
                    players: Array.from(this.players),
                    positions: Array.from(this.positions.entries()),
                    playerLists: Object.fromEntries(
                        Array.from(this.playerLists, ([name, perPlayer]) => [
                            name,
                            (perPlayer.get(playerID) || []).slice()
                        ])
                    ),
                    playerVariables: Object.fromEntries(
                        Array.from(this.playerVariables, ([name, perPlayer]) => [
                            name,
                            Object.fromEntries(perPlayer)
                        ])
                    )
                });

                // Send the costume snapshots already known by the host.
                for (const [costumePlayerID, costumeData] of this.costumes) {
                    connection.send({
                        type: 'costume',
                        playerID: costumePlayerID,
                        svg: costumeData.svg,
                        rotationCenterX: costumeData.rotationCenterX,
                        rotationCenterY: costumeData.rotationCenterY
                    });
                }

                this.lastJoinedPlayerID = playerID;
                this.runtime.startHats('multitools_whenPlayerJoins');

                this.broadcast({
                    type: 'playerJoined',
                    playerID: playerID
                }, peerID);
            });

            connection.on('data', data => {
                this.handleData(data, connection.peer);
            });

            connection.on('close', () => {
                const peerID = connection.peer;
                const playerID = this.peerToPlayerID.get(peerID);

                this.connections.delete(peerID);
                this.peerToPlayerID.delete(peerID);
                if (playerID !== undefined) {
                    this.playerIDToPeer.delete(playerID);
                    this.pingValues.delete(Number(playerID));
                    this.players.delete(playerID);
                    this.positions.delete(playerID);
                    this.costumes.delete(playerID);
                    for (const perPlayer of this.playerLists.values()) {
                        perPlayer.delete(playerID);
                    }
                    this.removeRemoteDrawable(playerID);

                    this.renumberPlayers();
                }
                this.updateSoloLobbyTimer();
                this.updateDashboard();
            });
        }

        handleData(data, senderID) {
            if (!data || typeof data !== 'object') return;

            if (data.type === 'serverFull') {
                this.status = 'Room is full';
                this.disconnect();
                this.status = 'Room is full';
                return;
            }

            if (data.type === 'serverLocked') {
                this.status = 'Room is locked';
                this.disconnect();
                this.status = 'Room is locked';
                return;
            }

            if (data.type === 'kicked' || data.type === 'serverShutdown') {
                const message = data.type === 'kicked' ? 'You were kicked by the host' : 'The host shut down the server';
                this.disconnect();
                this.status = message;
                return;
            }

            if (data.type === 'welcome') {
                const previousPlayerID = Number(this.myPlayerID);
                this.myPlayerID = Number(data.playerID);
                this.players = new Set(data.players || []);
                this.players.add(this.myPlayerID);

                if (data.hostID) this.players.add(Number(data.hostID));

                // Keep this client's private list contents while its player ID changes.
                for (const perPlayer of this.playerLists.values()) {
                    const ownItems = perPlayer.get(previousPlayerID);
                    if (Array.isArray(ownItems)) {
                        perPlayer.clear();
                        perPlayer.set(this.myPlayerID, ownItems.slice());
                    }
                }

                if (data.playerLists && typeof data.playerLists === 'object') {
                    for (const [name, values] of Object.entries(data.playerLists)) {
                        if (Array.isArray(values)) {
                            const existing = this.playerLists.get(name);
                            const preserved = existing && existing.get(this.myPlayerID);
                            const items = Array.isArray(preserved) ? preserved : values;
                            this.playerLists.set(name, new Map([[this.myPlayerID, items.slice(0, 100).map(String)]]));
                        }
                    }
                }

                if (data.playerVariables && typeof data.playerVariables === 'object') {
                    this.playerVariables.clear();
                    for (const [rawName, values] of Object.entries(data.playerVariables)) {
                        const name = String(rawName).slice(0, 64);
                        if (!name || !values || typeof values !== 'object') continue;
                        const perPlayer = new Map();
                        for (const [rawID, rawValue] of Object.entries(values)) {
                            const id = Number(rawID);
                            if (Number.isFinite(id)) perPlayer.set(id, String(rawValue).slice(0, 500));
                        }
                        this.playerVariables.set(name, perPlayer);
                    }
                }

                if (Array.isArray(data.positions)) {
                    data.positions.forEach(entry => {
                        if (Array.isArray(entry) && entry.length === 2) {
                            const id = entry[0];
                            const position = entry[1];

                            this.receivePosition(id, position.x, position.y, position.direction, position.size, position.visible, position.visibleToOthers, position.backdrop, position.backdropNumber);
                        }
                    });
                }

                // Restore this player's own list data after reconnecting to a migrated host.
                if (this.status === 'Connected') {
                    const restoredLists = {};
                    for (const [name, perPlayer] of this.playerLists) {
                        const items = perPlayer.get(this.myPlayerID);
                        if (Array.isArray(items)) restoredLists[name] = items.slice();
                    }
                    const host = this.connections.get('Host');
                    if (host && host.open) host.send({type: 'playerListRestore', lists: restoredLists});
                }

                return;
            }

            if (data.type === 'ping') {
                const connection = senderID === 'Host'
                    ? this.connections.get('Host')
                    : this.connections.get(senderID);
                if (connection && connection.open) {
                    connection.send({type: 'pong', id: data.id});
                }
                return;
            }

            if (data.type === 'pong') {
                const id = String(data.id);
                const pending = this.pendingPings.get(id);
                const connection = senderID === 'Host'
                    ? this.connections.get('Host')
                    : this.connections.get(senderID);
                if (pending && pending.connection === connection) {
                    this.pendingPings.delete(id);
                    this.pingValues.set(Number(pending.playerID), {
                        ms: Math.max(0, Math.round(Date.now() - pending.sentAt)),
                        updatedAt: Date.now()
                    });
                    this.updateDashboard();
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

            if (data.type === 'privateMessage' && this.status === 'Hosting') {
                const senderPlayerID = this.peerToPlayerID.get(senderID);
                const targetPlayerID = Number(data.targetPlayerID);
                const message = String(data.message === undefined ? '' : data.message).slice(0, 1000);
                if (senderPlayerID === undefined || !Number.isInteger(targetPlayerID) || !this.players.has(targetPlayerID)) return;

                const packet = {type: 'privateMessage', senderPlayerID: senderPlayerID, message: message};
                if (targetPlayerID === Number(this.myPlayerID)) {
                    this.lastPrivateMessage = message;
                    this.lastPrivateMessageSender = senderPlayerID;
                    this.runtime.startHats('multitools_whenPrivateMessageReceived');
                } else {
                    const targetPeerID = this.playerIDToPeer.get(targetPlayerID);
                    const targetConnection = targetPeerID && this.connections.get(targetPeerID);
                    if (targetConnection && targetConnection.open) targetConnection.send(packet);
                }
                return;
            }

            if (data.type === 'privateMessage') {
                this.lastPrivateMessage = String(data.message === undefined ? '' : data.message).slice(0, 1000);
                this.lastPrivateMessageSender = Number(data.senderPlayerID) || '';
                this.runtime.startHats('multitools_whenPrivateMessageReceived');
                return;
            }

            if (data.type === 'costume') {
                const playerID = senderID === 'Host'
                    ? Number(data.playerID)
                    : this.peerToPlayerID.get(senderID);

                this.receiveCostume(
                    playerID,
                    data.svg,
                    data.rotationCenterX,
                    data.rotationCenterY
                );

                // Relay client costume changes through the host.
                if (this.status === 'Hosting') {
                    this.broadcast({
                        type: 'costume',
                        playerID: playerID,
                        svg: data.svg,
                        rotationCenterX: data.rotationCenterX,
                        rotationCenterY: data.rotationCenterY
                    }, senderID);
                }

                return;
            }

            if (data.type === 'playerVisibility') {
                const playerID = senderID === 'Host'
                    ? Number(data.playerID)
                    : this.peerToPlayerID.get(senderID);

                if (playerID !== undefined && Number.isFinite(Number(playerID))) {
                    this.receivePlayerVisibility(playerID, data.visible, data.visibleToOthers);

                    if (this.status === 'Hosting') {
                        this.broadcast({
                            type: 'playerVisibility',
                            playerID: Number(playerID),
                            visible: data.visible,
                            visibleToOthers: data.visibleToOthers
                        }, senderID);
                    }
                }
                return;
            }

            if (data.type === 'position') {
                const playerID = senderID === 'Host'
                    ? Number(data.playerID)
                    : this.peerToPlayerID.get(senderID);

                this.receivePosition(playerID, data.x, data.y, data.direction, data.size, data.visible, data.visibleToOthers, data.backdrop, data.backdropNumber);

                // Relay client positions through the host.
                if (this.status === 'Hosting') {
                    this.broadcast({
                        type: 'position',
                        playerID: playerID,
                        x: data.x,
                        y: data.y,
                        direction: data.direction,
                        size: data.size,
                        visible: data.visible,
                        visibleToOthers: data.visibleToOthers,
                        backdrop: data.backdrop,
                        backdropNumber: data.backdropNumber
                    }, senderID);
                }

                return;
            }

            if (data.type === 'playerVariableUpdate' && this.status === 'Hosting') {
                const playerID = this.peerToPlayerID.get(senderID);
                const name = String(data.name || '').trim().slice(0, 64);
                if (playerID !== undefined && name) {
                    let perPlayer = this.playerVariables.get(name);
                    if (!perPlayer) {
                        perPlayer = new Map();
                        this.playerVariables.set(name, perPlayer);
                    }
                    perPlayer.set(playerID, String(data.value === undefined ? '' : data.value).slice(0, 500));
                    this.broadcast({type: 'playerVariableUpdate', playerID: playerID, name: name, value: perPlayer.get(playerID)});
                }
                return;
            }

            if (data.type === 'playerVariableDelete' && this.status === 'Hosting') {
                const playerID = this.peerToPlayerID.get(senderID);
                const name = String(data.name || '').trim().slice(0, 64);
                const perPlayer = this.playerVariables.get(name);
                if (playerID !== undefined && perPlayer) {
                    perPlayer.delete(playerID);
                    this.broadcast({type: 'playerVariableDelete', playerID: playerID, name: name});
                }
                return;
            }

            if (data.type === 'playerVariableUpdate') {
                const name = String(data.name || '').trim().slice(0, 64);
                const playerID = Number(data.playerID);
                if (name && Number.isFinite(playerID)) {
                    let perPlayer = this.playerVariables.get(name);
                    if (!perPlayer) {
                        perPlayer = new Map();
                        this.playerVariables.set(name, perPlayer);
                    }
                    perPlayer.set(playerID, String(data.value === undefined ? '' : data.value).slice(0, 500));
                }
                return;
            }

            if (data.type === 'playerVariableDelete') {
                const name = String(data.name || '').trim().slice(0, 64);
                const perPlayer = this.playerVariables.get(name);
                if (perPlayer) perPlayer.delete(Number(data.playerID));
                return;
            }

            if (data.type === 'playerListCreated') {
                const name = String(data.name || '').slice(0, 64);
                if (name && !this.playerLists.has(name)) {
                    this.playerLists.set(name, new Map([[Number(this.myPlayerID), []]]));
                }
                return;
            }

            if (data.type === 'playerListSnapshot') {
                const name = String(data.name || '').slice(0, 64);
                if (name && Array.isArray(data.items)) {
                    this.playerLists.set(name, new Map([[Number(this.myPlayerID), data.items.slice(0, 100).map(String)]]));
                }
                return;
            }

            if (data.type === 'playerListRestore' && this.status === 'Hosting') {
                const playerID = this.peerToPlayerID.get(senderID);
                if (playerID !== undefined && data.lists && typeof data.lists === 'object') {
                    for (const [rawName, rawItems] of Object.entries(data.lists)) {
                        const name = String(rawName).slice(0, 64);
                        if (!name || !Array.isArray(rawItems)) continue;
                        if (!this.playerLists.has(name)) this.playerLists.set(name, new Map());
                        this.playerLists.get(name).set(playerID, rawItems.slice(0, 100).map(item => String(item).slice(0, 500)));
                    }
                    this.updateDashboard();
                }
                return;
            }

            if (data.type === 'playerListOperation' && this.status === 'Hosting') {
                const playerID = this.peerToPlayerID.get(senderID);
                if (playerID !== undefined) {
                    this.applyPlayerListOperation(playerID, data.operation, data.name, data.item, data.index);
                    const perPlayer = this.playerLists.get(String(data.name));
                    const items = perPlayer ? (perPlayer.get(playerID) || []) : [];
                    const connection = this.connections.get(senderID);
                    if (connection && connection.open) {
                        connection.send({type: 'playerListSnapshot', name: String(data.name), items: items.slice()});
                    }
                    this.updateDashboard();
                }
                return;
            }

            if (data.type === 'playerIDsUpdated') {
                this.applyPlayerIDMap(data);
                return;
            }

            if (data.type === 'playerJoined') {
                this.players.add(Number(data.playerID));
                this.lastJoinedPlayerID = Number(data.playerID);

                this.runtime.startHats(
                    'multitools_whenPlayerJoins'
                );

                return;
            }

            if (data.type === 'playerLeft') {
                this.players.delete(Number(data.playerID));
                for (const perPlayer of this.playerLists.values()) {
                    perPlayer.delete(Number(data.playerID));
                }
                for (const perPlayer of this.playerVariables.values()) {
                    perPlayer.delete(Number(data.playerID));
                }
                this.positions.delete(Number(data.playerID));
                this.pingValues.delete(Number(data.playerID));
                this.costumes.delete(Number(data.playerID));
                this.removeRemoteDrawable(data.playerID);
                return;
            }

            if (data.type === 'removePosition') {
                this.positions.delete(Number(data.playerID));
            }
        }

        getNextPlayerID() {
            let candidate = 2;
            while (this.playerIDToPeer.has(candidate)) candidate++;
            return candidate;
        }

        renumberPlayers() {
            if (this.status !== 'Hosting') return;
            const oldIDs = Array.from(this.players).map(Number).sort((a, b) => a - b);
            const mapping = {};
            oldIDs.forEach((oldID, index) => {
                mapping[oldID] = index + 1;
            });

            const remapMap = source => {
                const result = new Map();
                for (const [oldID, value] of source) {
                    const nextID = mapping[Number(oldID)];
                    if (nextID !== undefined) result.set(nextID, value);
                }
                return result;
            };

            this.players = new Set(oldIDs.map(oldID => mapping[oldID]));
            const previousPeerToPlayerID = new Map(this.peerToPlayerID);
            this.peerToPlayerID = new Map();
            this.playerIDToPeer = new Map();
            for (const [peerID, oldID] of previousPeerToPlayerID) {
                const nextID = mapping[Number(oldID)];
                if (nextID !== undefined) {
                    this.peerToPlayerID.set(peerID, nextID);
                    this.playerIDToPeer.set(nextID, peerID);
                }
            }

            this.positions = remapMap(this.positions);
            this.pingValues = remapMap(this.pingValues);
            this.costumes = remapMap(this.costumes);
            this.remoteDrawables = remapMap(this.remoteDrawables);
            this.remoteSkinIds = remapMap(this.remoteSkinIds);
            for (const [name, perPlayer] of this.playerLists) {
                this.playerLists.set(name, remapMap(perPlayer));
            }
            this.myPlayerID = 1;

            const update = {
                type: 'playerIDsUpdated',
                mapping: mapping,
                players: Array.from(this.players)
            };
            for (const connection of this.connections.values()) {
                if (connection.open) connection.send(update);
            }
            this.updateDashboard();
        }

        applyPlayerIDMap(data) {
            if (!data.mapping || typeof data.mapping !== 'object') return;
            const mapping = {};
            for (const [oldID, newID] of Object.entries(data.mapping)) {
                const oldNumber = Number(oldID);
                const newNumber = Number(newID);
                if (Number.isInteger(oldNumber) && Number.isInteger(newNumber)) {
                    mapping[oldNumber] = newNumber;
                }
            }
            const remapMap = source => {
                const result = new Map();
                for (const [oldID, value] of source) {
                    const nextID = mapping[Number(oldID)];
                    if (nextID !== undefined) result.set(nextID, value);
                    else if (source === this.remoteDrawables) this.runtime.renderer.destroyDrawable(value);
                    else if (source === this.remoteSkinIds) this.runtime.renderer.destroySkin(value);
                }
                return result;
            };

            const oldMyID = Number(this.myPlayerID);
            if (mapping[oldMyID] !== undefined) this.myPlayerID = mapping[oldMyID];
            this.players = new Set((data.players || []).map(Number));
            this.positions = remapMap(this.positions);
            this.pingValues = remapMap(this.pingValues);
            this.costumes = remapMap(this.costumes);
            this.remoteDrawables = remapMap(this.remoteDrawables);
            this.remoteSkinIds = remapMap(this.remoteSkinIds);
            for (const [name, perPlayer] of this.playerLists) {
                this.playerLists.set(name, remapMap(perPlayer));
            }
            if (mapping[Number(this.lastJoinedPlayerID)] !== undefined) {
                this.lastJoinedPlayerID = mapping[Number(this.lastJoinedPlayerID)];
            }
            if (mapping[Number(this.lastPositionPlayerID)] !== undefined) {
                this.lastPositionPlayerID = mapping[Number(this.lastPositionPlayerID)];
            }
            this.updateDashboard();
        }

        updateSoloLobbyTimer() {
            if (this.soloLobbyTimer) {
                clearTimeout(this.soloLobbyTimer);
                this.soloLobbyTimer = null;
            }

            // Only the host controls the lifetime of the room.
            if (this.status !== 'Hosting' || this.players.size !== 1) return;

            this.soloLobbyTimer = setTimeout(() => {
                this.soloLobbyTimer = null;

                if (this.status === 'Hosting' && this.players.size === 1) {
                    this.disconnect();
                    this.status = 'Lobby closed: alone for 1 minute';
                }
            }, 60 * 1000);
        }

        ensureRemoteDrawable(playerID) {
            const numericID = Number(playerID);
            const renderer = this.runtime && this.runtime.renderer;
            if (!Number.isFinite(numericID) || numericID <= 0 ||
                numericID === Number(this.myPlayerID) ||
                !renderer || typeof renderer.createDrawable !== 'function') return null;

            let drawableID = this.remoteDrawables.get(numericID);
            if (drawableID !== undefined && drawableID !== null) return drawableID;

            // Remote players are renderer drawables, not Scratch clones/targets.
            drawableID = renderer.createDrawable('sprite');
            if (drawableID === null || drawableID === undefined) return null;

            this.remoteDrawables.set(numericID, drawableID);

            this.placeRemoteDrawableBehindLocal(drawableID);
            this.updateRemoteDrawable(numericID, drawableID);
            return drawableID;
        }

        placeRemoteDrawableBehindLocal(drawableID) {
            const renderer = this.runtime && this.runtime.renderer;
            if (!this.syncTarget || this.syncTarget.drawableID === null ||
                this.syncTarget.drawableID === undefined || drawableID === null ||
                drawableID === undefined || !renderer ||
                typeof renderer.setDrawableOrder !== 'function') return;

            // Match the old clone behaviour: remote players sit behind the local sprite.
            const localLayer = renderer.setDrawableOrder(
                this.syncTarget.drawableID, 0, 'sprite', true
            );
            if (localLayer !== null && localLayer !== undefined) {
                renderer.setDrawableOrder(drawableID, localLayer, 'sprite');
            }
        }

        updateRemoteDrawable(playerID, drawableID) {
            const numericID = Number(playerID);
            const renderer = this.runtime && this.runtime.renderer;
            const position = this.positions.get(numericID);
            if (!renderer || !position) return;

            if (drawableID === undefined || drawableID === null) {
                drawableID = this.remoteDrawables.get(numericID);
            }
            if (drawableID === undefined || drawableID === null) return;

            if (typeof renderer.updateDrawablePosition === 'function') {
                renderer.updateDrawablePosition(drawableID, [
                    Number.isFinite(position.x) ? position.x : 0,
                    Number.isFinite(position.y) ? position.y : 0
                ]);
            }

            if (typeof renderer.updateDrawableDirectionScale === 'function') {
                let direction = Number.isFinite(position.direction) ? position.direction : 90;
                const size = Number.isFinite(position.size) ? position.size : 100;
                let scale = [size, size];
                const rotationStyle = this.syncTarget && this.syncTarget.rotationStyle;

                if (rotationStyle === "don't rotate") {
                    direction = 90;
                } else if (rotationStyle === 'left-right') {
                    direction = 90;
                    scale = [(Number.isFinite(position.direction) && position.direction < 0 ? -1 : 1) * size, size];
                }

                renderer.updateDrawableDirectionScale(drawableID, direction, scale);
            }

            // Hiding a player means skipping its drawable, not hiding/deleting a clone.
            if (typeof renderer.updateDrawableVisible === 'function') {
                const visible = position.visible !== false && position.visibleToOthers !== false;
                renderer.updateDrawableVisible(drawableID, visible);
            }

            if (this.runtime && typeof this.runtime.requestRedraw === 'function') {
                this.runtime.requestRedraw();
            }
        }

        applyRemoteCostume(playerID, drawableID) {
            const numericID = Number(playerID);
            const costumeData = this.costumes.get(numericID);
            const renderer = this.runtime && this.runtime.renderer;
            if (!costumeData || drawableID === null || drawableID === undefined ||
                !renderer || typeof renderer.createSVGSkin !== 'function' ||
                typeof renderer.updateDrawableSkinId !== 'function') return;

            const skinId = renderer.createSVGSkin(costumeData.svg, [
                costumeData.rotationCenterX,
                costumeData.rotationCenterY
            ]);
            if (skinId === null || skinId === undefined) return;

            renderer.updateDrawableSkinId(drawableID, skinId);

            const oldSkinId = this.remoteSkinIds.get(numericID);
            this.remoteSkinIds.set(numericID, skinId);
            if (oldSkinId !== undefined && typeof renderer.destroySkin === 'function') {
                renderer.destroySkin(oldSkinId);
            }

            this.updateRemoteDrawable(numericID, drawableID);
        }

        receiveCostume(playerID, svg, rotationCenterX, rotationCenterY) {
            const numericID = Number(playerID);
            if (!Number.isFinite(numericID) || numericID <= 0) return;
            if (typeof svg !== 'string' || !svg.trim() || svg.length > 200000) return;

            const costumeData = {
                svg: svg,
                rotationCenterX: Number.isFinite(Number(rotationCenterX)) ? Number(rotationCenterX) : 0,
                rotationCenterY: Number.isFinite(Number(rotationCenterY)) ? Number(rotationCenterY) : 0
            };
            this.costumes.set(numericID, costumeData);
            if (numericID === Number(this.myPlayerID)) return;

            const drawableID = this.ensureRemoteDrawable(numericID);
            if (drawableID !== null) this.applyRemoteCostume(numericID, drawableID);
        }

        removeRemoteDrawable(playerID) {
            const numericID = Number(playerID);
            const drawableID = this.remoteDrawables.get(numericID);
            const renderer = this.runtime && this.runtime.renderer;
            if (drawableID !== undefined && renderer &&
                typeof renderer.destroyDrawable === 'function') {
                renderer.destroyDrawable(drawableID);
                this.remoteDrawables.delete(numericID);
            }

            const skinId = this.remoteSkinIds.get(numericID);
            if (skinId !== undefined) {
                if (renderer && typeof renderer.destroySkin === 'function') {
                    renderer.destroySkin(skinId);
                }
                this.remoteSkinIds.delete(numericID);
            }

            if (this.runtime && typeof this.runtime.requestRedraw === 'function') {
                this.runtime.requestRedraw();
            }
        }

        getCurrentBackdropName() {
            const stage = this.runtime.getTargetForStage
                ? this.runtime.getTargetForStage()
                : this.runtime.targets.find(target => target.isStage);
            if (!stage || !stage.sprite || !stage.sprite.costumes) return '';
            const costume = stage.sprite.costumes[stage.currentCostume];
            return costume && costume.name ? String(costume.name) : '';
        }

        getCurrentBackdropNumber() {
            const stage = this.runtime.getTargetForStage
                ? this.runtime.getTargetForStage()
                : this.runtime.targets.find(target => target.isStage);
            return stage && Number.isInteger(stage.currentCostume)
                ? stage.currentCostume + 1
                : 0;
        }

        receivePlayerVisibility(playerID, visible, visibleToOthers) {
            const numericID = Number(playerID);
            if (!Number.isFinite(numericID) || numericID <= 0) return;

            const position = this.positions.get(numericID) || {x: 0, y: 0};
            if (typeof visible === 'boolean') position.visible = visible;
            if (typeof visibleToOthers === 'boolean') position.visibleToOthers = visibleToOthers;
            this.positions.set(numericID, position);
            this.players.add(numericID);

            if (numericID !== Number(this.myPlayerID)) {
                const drawableID = this.ensureRemoteDrawable(numericID);
                if (drawableID !== null) this.updateRemoteDrawable(numericID, drawableID);
            }
        }

        receivePosition(playerID, x, y, direction, size, visible, visibleToOthers, backdrop, backdropNumber) {
            const numericID = Number(playerID);
            if (!Number.isFinite(numericID) || numericID <= 0) return;
            if (!Number.isFinite(Number(x)) ||
                !Number.isFinite(Number(y))) return;

            const position = {
                x: Number(x),
                y: Number(y)
            };
            if (Number.isFinite(Number(direction))) {
                position.direction = Number(direction);
            }
            if (Number.isFinite(Number(size))) {
                position.size = Number(size);
            }
            if (typeof visible === 'boolean') {
                position.visible = visible;
            }
            if (typeof visibleToOthers === 'boolean') {
                position.visibleToOthers = visibleToOthers;
            }
            if (typeof backdrop === 'string') {
                position.backdrop = backdrop.slice(0, 128);
            }
            if (Number.isFinite(Number(backdropNumber))) {
                position.backdropNumber = Number(backdropNumber);
            }

            this.positions.set(numericID, position);
            this.players.add(numericID);
            this.lastPositionPlayerID = numericID;

            if (numericID !== Number(this.myPlayerID)) {
                const drawableID = this.ensureRemoteDrawable(numericID);
                if (drawableID !== null) this.updateRemoteDrawable(numericID, drawableID);
            }

            this.runtime.startHats(
                'multitools_whenPlayerPositionUpdates'
            );
        }

        showDashboard() {
            if (this.status !== 'Hosting') {
                this.status = 'Only the host can open the dashboard';
                return;
            }
            this.createDashboard();
            this.dashboardVisible = true;
            this.dashboardElement.style.display = 'block';
            this.updateDashboard();
        }

        hideDashboard() {
            this.dashboardVisible = false;
            if (this.dashboardElement) this.dashboardElement.style.display = 'none';
        }

        createDashboard() {
            if (this.dashboardElement || !document.body) return;

            const panel = document.createElement('div');
            panel.id = 'multitools-host-dashboard';
            panel.style.cssText = 'position:fixed;right:18px;top:18px;width:320px;max-height:80vh;overflow:auto;z-index:2147483647;background:#171923;color:#f7f7fb;border:1px solid #5865f2;border-radius:12px;padding:14px;font:14px Arial,sans-serif;box-shadow:0 8px 32px #0008;';
            const style = document.createElement('style');
            style.textContent = '#multitools-host-dashboard button{cursor:pointer;border:0;border-radius:6px;padding:6px 9px;background:#5865f2;color:white;font-weight:600}#multitools-host-dashboard input{box-sizing:border-box;max-width:100%;background:#242735;color:white;border:1px solid #555b70;border-radius:6px;padding:6px}#multitools-host-dashboard .mt-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0}#multitools-host-dashboard .mt-muted{color:#aeb3c2;font-size:12px}#multitools-host-dashboard .mt-player{padding:7px 0;border-bottom:1px solid #343847}#multitools-host-dashboard .mt-danger{background:#c0394b}';
            panel.appendChild(style);

            const title = document.createElement('div');
            title.className = 'mt-row';
            const heading = document.createElement('strong');
            heading.textContent = 'MultiTools • Host Dashboard';
            const close = document.createElement('button');
            close.textContent = 'Hide';
            close.addEventListener('click', () => this.hideDashboard());
            title.append(heading, close);
            panel.appendChild(title);

            this.dashboardStatus = document.createElement('div');
            this.dashboardStatus.className = 'mt-muted';
            panel.appendChild(this.dashboardStatus);

            const listsHeading = document.createElement('h3');
            listsHeading.textContent = 'Player Lists';
            listsHeading.style.margin = '14px 0 6px';
            panel.appendChild(listsHeading);
            this.dashboardListPlayer = document.createElement('select');
            this.dashboardListName = document.createElement('select');
            this.dashboardListOutput = document.createElement('pre');
            this.dashboardListOutput.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;background:#242735;padding:8px;border-radius:6px;max-height:130px;overflow:auto;';
            this.dashboardListPlayer.addEventListener('change', () => this.updateDashboardListView());
            this.dashboardListName.addEventListener('change', () => this.updateDashboardListView());
            const listPickRow = document.createElement('div');
            listPickRow.className = 'mt-row';
            listPickRow.append(this.dashboardListPlayer, this.dashboardListName);
            panel.append(listPickRow, this.dashboardListOutput);

            const bandwidthHeading = document.createElement('h3');
            bandwidthHeading.textContent = 'Bandwidth';
            bandwidthHeading.style.margin = '14px 0 6px';
            panel.appendChild(bandwidthHeading);
            this.dashboardBandwidth = document.createElement('div');
            this.dashboardBandwidth.className = 'mt-muted';
            panel.appendChild(this.dashboardBandwidth);

            const playersHeading = document.createElement('h3');
            playersHeading.textContent = 'Players';
            playersHeading.style.margin = '14px 0 4px';
            panel.appendChild(playersHeading);
            this.dashboardPlayers = document.createElement('div');
            panel.appendChild(this.dashboardPlayers);

            const settingsHeading = document.createElement('h3');
            settingsHeading.textContent = 'Server controls';
            settingsHeading.style.margin = '14px 0 6px';
            panel.appendChild(settingsHeading);

            const limitRow = document.createElement('div');
            limitRow.className = 'mt-row';
            const limitLabel = document.createElement('label');
            limitLabel.textContent = 'Maximum players';
            this.dashboardLimit = document.createElement('input');
            this.dashboardLimit.type = 'number';
            this.dashboardLimit.min = '1';
            this.dashboardLimit.max = '100';
            this.dashboardLimit.value = String(this.maxPlayers);
            this.dashboardLimit.style.width = '68px';
            const saveLimit = document.createElement('button');
            saveLimit.textContent = 'Set';
            saveLimit.addEventListener('click', () => {
                const value = Math.floor(Number(this.dashboardLimit.value));
                if (!Number.isFinite(value) || value < 1) {
                    this.dashboardLimit.value = String(this.maxPlayers);
                    return;
                }
                this.maxPlayers = Math.min(100, value);
                this.dashboardLimit.value = String(this.maxPlayers);
                this.updateDashboard();
            });
            limitRow.append(limitLabel, this.dashboardLimit, saveLimit);
            panel.appendChild(limitRow);

            const lockRow = document.createElement('div');
            lockRow.className = 'mt-row';
            const lockLabel = document.createElement('label');
            lockLabel.textContent = 'Lock room (block new joins)';
            this.dashboardLock = document.createElement('input');
            this.dashboardLock.type = 'checkbox';
            this.dashboardLock.addEventListener('change', () => {
                this.roomLocked = this.dashboardLock.checked;
                this.updateDashboard();
            });
            lockRow.append(lockLabel, this.dashboardLock);
            panel.appendChild(lockRow);

            const messageHeading = document.createElement('h3');
            messageHeading.textContent = 'Broadcast message';
            messageHeading.style.margin = '14px 0 6px';
            panel.appendChild(messageHeading);
            const messageRow = document.createElement('div');
            messageRow.className = 'mt-row';
            this.dashboardMessage = document.createElement('input');
            this.dashboardMessage.type = 'text';
            this.dashboardMessage.placeholder = 'Message to everyone';
            this.dashboardMessage.style.flex = '1';
            const sendMessageButton = document.createElement('button');
            sendMessageButton.textContent = 'Send';
            sendMessageButton.addEventListener('click', () => {
                const message = this.dashboardMessage.value.trim();
                if (!message) return;
                this.sendMessage({MESSAGE: '[HOST] ' + message});
                this.dashboardMessage.value = '';
            });
            messageRow.append(this.dashboardMessage, sendMessageButton);
            panel.appendChild(messageRow);

            const shutdown = document.createElement('button');
            shutdown.textContent = 'Shut down server';
            shutdown.className = 'mt-danger';
            shutdown.style.width = '100%';
            shutdown.style.marginTop = '12px';
            shutdown.addEventListener('click', () => {
                if (!window.confirm('Shut down this server and disconnect all players?')) return;
                this.broadcast({type: 'serverShutdown'});
                this.roomLocked = true;
                setTimeout(() => this.disconnect(), 250);
            });
            panel.appendChild(shutdown);

            document.body.appendChild(panel);
            this.dashboardElement = panel;
            this.dashboardElement.style.display = this.dashboardVisible ? 'block' : 'none';
        }

        updateDashboard() {
            if (!this.dashboardElement) return;
            if (this.dashboardStatus) {
                this.dashboardStatus.textContent = 'Room: ' + (this.roomID || '—') +
                    ' • Status: ' + this.status +
                    ' • Players: ' + this.players.size + '/' + this.maxPlayers;
            }
            if (this.dashboardLimit && document.activeElement !== this.dashboardLimit) {
                this.dashboardLimit.value = String(this.maxPlayers);
            }
            if (this.dashboardLock) this.dashboardLock.checked = this.roomLocked;
            if (this.dashboardBandwidth) {
                this.dashboardBandwidth.textContent =
                    'Sent: ' + this.formatBytes(this.bandwidthSent) +
                    ' • Received: ' + this.formatBytes(this.bandwidthReceived) +
                    '\\nUpload: ' + this.uploadRate.toFixed(2) + ' KB/s' +
                    ' • Download: ' + this.downloadRate.toFixed(2) + ' KB/s';
            }
            if (this.dashboardListPlayer && this.dashboardListName) {
                const previousPlayer = this.dashboardListPlayer.value;
                const previousList = this.dashboardListName.value;
                this.dashboardListPlayer.textContent = '';
                Array.from(this.players).sort((a, b) => Number(a) - Number(b)).forEach(id => {
                    const option = document.createElement('option');
                    option.value = String(id);
                    option.textContent = 'Player ' + id;
                    this.dashboardListPlayer.appendChild(option);
                });
                if (Array.from(this.players).some(id => String(id) === previousPlayer)) {
                    this.dashboardListPlayer.value = previousPlayer;
                }
                this.dashboardListName.textContent = '';
                for (const name of this.playerLists.keys()) {
                    const option = document.createElement('option');
                    option.value = name;
                    option.textContent = name;
                    this.dashboardListName.appendChild(option);
                }
                if (this.playerLists.has(previousList)) this.dashboardListName.value = previousList;
                this.updateDashboardListView();
            }
            if (this.dashboardPlayers) {
                this.dashboardPlayers.textContent = '';
                const ids = Array.from(this.players).sort((a, b) => Number(a) - Number(b));
                ids.forEach(playerID => {
                    const row = document.createElement('div');
                    row.className = 'mt-row mt-player';
                    const name = document.createElement('span');
                    const ping = this.pingValues.get(Number(playerID));
                    const pingFresh = ping && Date.now() - ping.updatedAt <= 6000;
                    const pingLabel = Number(playerID) === 1
                        ? ' • Local host'
                        : ' • ' + (pingFresh ? ping.ms + ' ms' : 'Ping: —');
                    name.textContent = 'Player ' + playerID + (Number(playerID) === 1 ? ' (Host)' : '') + pingLabel;
                    row.appendChild(name);
                    if (Number(playerID) !== 1) {
                        const kick = document.createElement('button');
                        kick.textContent = 'Kick';
                        kick.className = 'mt-danger';
                        kick.addEventListener('click', () => this.kickPlayer(playerID));
                        row.appendChild(kick);
                    }
                    this.dashboardPlayers.appendChild(row);
                });
                if (!ids.length) {
                    const empty = document.createElement('div');
                    empty.className = 'mt-muted';
                    empty.textContent = 'No players connected';
                    this.dashboardPlayers.appendChild(empty);
                }
            }
        }

        updateDashboardListView() {
            if (!this.dashboardListOutput || !this.dashboardListName || !this.dashboardListPlayer) return;
            const name = this.dashboardListName.value;
            const playerID = Number(this.dashboardListPlayer.value);
            const perPlayer = this.playerLists.get(name);
            const items = perPlayer && perPlayer.get(playerID);
            this.dashboardListOutput.textContent = name
                ? (items ? JSON.stringify(items, null, 2) : 'No list data for this player yet.')
                : 'No player lists created yet.';
        }

        kickPlayer(playerID) {
            if (this.status !== 'Hosting' || Number(playerID) === 1) return;
            const peerID = this.playerIDToPeer.get(Number(playerID));
            const connection = peerID && this.connections.get(peerID);
            if (!connection) return;
            if (connection.open) connection.send({type: 'kicked'});
            setTimeout(() => {
                try { connection.close(); } catch (error) {}
            }, 100);
        }

        setMyPlayerVariable(args) {
            const name = String(args.NAME || '').trim().slice(0, 64);
            if (!name || !this.myPlayerID || !['Hosting', 'Connected'].includes(this.status)) return;
            const value = String(args.VALUE === undefined ? '' : args.VALUE).slice(0, 500);
            let perPlayer = this.playerVariables.get(name);
            if (!perPlayer) {
                perPlayer = new Map();
                this.playerVariables.set(name, perPlayer);
            }
            perPlayer.set(Number(this.myPlayerID), value);
            if (this.status === 'Hosting') {
                this.broadcast({type: 'playerVariableUpdate', playerID: Number(this.myPlayerID), name: name, value: value});
            } else {
                const host = this.connections.get('Host');
                if (host && host.open) host.send({type: 'playerVariableUpdate', name: name, value: value});
            }
        }

        getPlayerVariable(args) {
            const name = String(args.NAME || '').trim().slice(0, 64);
            const playerID = Math.floor(Number(args.PLAYER));
            const perPlayer = this.playerVariables.get(name);
            return perPlayer && perPlayer.has(playerID) ? perPlayer.get(playerID) : '';
        }

        deleteMyPlayerVariable(args) {
            const name = String(args.NAME || '').trim().slice(0, 64);
            if (!name || !this.myPlayerID || !['Hosting', 'Connected'].includes(this.status)) return;
            const perPlayer = this.playerVariables.get(name);
            if (perPlayer) perPlayer.delete(Number(this.myPlayerID));
            if (this.status === 'Hosting') {
                this.broadcast({type: 'playerVariableDelete', playerID: Number(this.myPlayerID), name: name});
            } else {
                const host = this.connections.get('Host');
                if (host && host.open) host.send({type: 'playerVariableDelete', name: name});
            }
        }

        createPlayerList(args) {
            if (this.status !== 'Hosting') return;
            const name = String(args.LIST || '').trim().slice(0, 64);
            if (!name || this.playerLists.has(name)) return;
            const perPlayer = new Map();
            for (const playerID of this.players) perPlayer.set(Number(playerID), []);
            this.playerLists.set(name, perPlayer);
            this.broadcast({type: 'playerListCreated', name: name});
            this.updateDashboard();
        }

        applyPlayerListOperation(playerID, operation, listName, item, index) {
            const name = String(listName || '').trim().slice(0, 64);
            const perPlayer = this.playerLists.get(name);
            if (!perPlayer) return false;
            const id = Number(playerID);
            if (!Number.isFinite(id) || !this.players.has(id)) return false;
            let items = perPlayer.get(id);
            if (!items) {
                items = [];
                perPlayer.set(id, items);
            }
            const value = String(item === undefined ? '' : item).slice(0, 500);
            if (operation === 'add') {
                if (items.length >= 100) return false;
                items.push(value);
            } else if (operation === 'remove') {
                const at = items.indexOf(value);
                if (at !== -1) items.splice(at, 1);
            } else if (operation === 'replace') {
                const at = Math.floor(Number(index)) - 1;
                if (at >= 0 && at < items.length) items[at] = value;
            } else {
                return false;
            }
            return true;
        }

        modifyMyPlayerList(operation, name, item, index) {
            const listName = String(name || '').trim().slice(0, 64);
            if (!this.myPlayerID || !this.playerLists.has(listName)) return;
            if (this.status === 'Hosting') {
                this.applyPlayerListOperation(this.myPlayerID, operation, listName, item, index);
                this.updateDashboard();
            } else if (this.status === 'Connected') {
                // Optimistic local update; host sends back its authoritative snapshot.
                this.applyPlayerListOperation(this.myPlayerID, operation, listName, item, index);
                const host = this.connections.get('Host');
                if (host && host.open) {
                    host.send({type: 'playerListOperation', operation: operation, name: listName, item: String(item), index: index});
                }
            }
        }

        addToPlayerList(args) {
            this.modifyMyPlayerList('add', args.LIST, args.ITEM, 0);
        }

        removeFromPlayerList(args) {
            this.modifyMyPlayerList('remove', args.LIST, args.ITEM, 0);
        }

        replacePlayerListItem(args) {
            this.modifyMyPlayerList('replace', args.LIST, args.ITEM, args.INDEX);
        }

        getPlayerListItem(args) {
            const perPlayer = this.playerLists.get(String(args.LIST));
            const items = perPlayer && perPlayer.get(Number(this.myPlayerID));
            const index = Math.floor(Number(args.INDEX)) - 1;
            return items && index >= 0 && index < items.length ? items[index] : '';
        }

        getPlayerListLength(args) {
            const perPlayer = this.playerLists.get(String(args.LIST));
            const items = perPlayer && perPlayer.get(Number(this.myPlayerID));
            return items ? items.length : 0;
        }

        getPlayerListContents(args) {
            const perPlayer = this.playerLists.get(String(args.LIST));
            const items = perPlayer && perPlayer.get(Number(this.myPlayerID));
            return items ? JSON.stringify(items) : '[]';
        }

        getOtherPlayerList(args) {
            if (this.status !== 'Hosting') return '[]';
            const perPlayer = this.playerLists.get(String(args.LIST));
            const items = perPlayer && perPlayer.get(Number(args.PLAYER));
            return items ? JSON.stringify(items) : '[]';
        }

        startPingMonitor() {
            if (this.pingTimer) return;
            const sendPings = () => {
                if (this.status === 'Hosting') {
                    for (const [peerID, connection] of this.connections) {
                        const playerID = this.peerToPlayerID.get(peerID);
                        if (playerID !== undefined) this.sendPing(connection, playerID);
                    }
                } else if (this.status === 'Connected') {
                    const host = this.connections.get('Host');
                    if (host) this.sendPing(host, 1);
                }
                const now = Date.now();
                for (const [id, pending] of this.pendingPings) {
                    if (now - pending.sentAt > 10000) this.pendingPings.delete(id);
                }
                for (const [playerID, sample] of this.pingValues) {
                    if (now - sample.updatedAt > 6000) this.pingValues.delete(playerID);
                }
                this.updateDashboard();
            };
            sendPings();
            this.pingTimer = setInterval(sendPings, 2000);
        }

        sendPing(connection, playerID) {
            if (!connection || !connection.open) return;
            for (const pending of this.pendingPings.values()) {
                if (pending.connection === connection) return;
            }
            const id = String(++this.pingSequence);
            this.pendingPings.set(id, {connection: connection, playerID: Number(playerID), sentAt: Date.now()});
            try {
                connection.send({type: 'ping', id: id});
            } catch (error) {
                this.pendingPings.delete(id);
            }
        }

        getPingToHost() {
            if (this.status === 'Hosting') return 0;
            const sample = this.pingValues.get(1);
            return sample && Date.now() - sample.updatedAt <= 6000 ? sample.ms : 0;
        }

        getPlayerPing(args) {
            const sample = this.pingValues.get(Number(args.ID));
            return sample && Date.now() - sample.updatedAt <= 6000 ? sample.ms : 0;
        }

        startBandwidthMonitor() {
            if (this.bandwidthTimer) return;
            this.bandwidthTimer = setInterval(() => this.sampleBandwidth(), 1000);
        }

        async sampleBandwidth() {
            if (this.bandwidthSampling) return;
            this.bandwidthSampling = true;
            let sentThisSecond = 0;
            let receivedThisSecond = 0;
            const active = new Set(this.connections.values());
            try {
                for (const connection of active) {
                    const pc = connection && connection.peerConnection;
                    if (!pc || typeof pc.getStats !== 'function') continue;
                    try {
                        const report = await pc.getStats();
                        const stats = Array.from(report.values ? report.values() : []);
                        let transport = stats.filter(stat => stat.type === 'transport' &&
                            Number.isFinite(stat.bytesSent) && Number.isFinite(stat.bytesReceived));
                        if (!transport.length) {
                            transport = stats.filter(stat => stat.type === 'candidate-pair' &&
                                stat.selected === true &&
                                Number.isFinite(stat.bytesSent) && Number.isFinite(stat.bytesReceived));
                        }
                        const current = transport.reduce((totals, stat) => ({
                            sent: totals.sent + stat.bytesSent,
                            received: totals.received + stat.bytesReceived
                        }), {sent: 0, received: 0});
                        const previous = this.bandwidthBaselines.get(connection);
                        if (previous) {
                            sentThisSecond += Math.max(0, current.sent - previous.sent);
                            receivedThisSecond += Math.max(0, current.received - previous.received);
                        }
                        this.bandwidthBaselines.set(connection, current);
                    } catch (error) {
                        // A connection may close while its stats are being read.
                    }
                }
                for (const connection of this.bandwidthBaselines.keys()) {
                    if (!active.has(connection)) this.bandwidthBaselines.delete(connection);
                }
                this.bandwidthSent += sentThisSecond;
                this.bandwidthReceived += receivedThisSecond;
                this.uploadRate = sentThisSecond / 1024;
                this.downloadRate = receivedThisSecond / 1024;
                this.updateDashboard();
            } finally {
                this.bandwidthSampling = false;
            }
        }

        formatBytes(bytes) {
            if (bytes < 1024) return bytes.toFixed(0) + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
        }

        getBandwidthSent() {
            return Math.round(this.bandwidthSent);
        }

        getBandwidthReceived() {
            return Math.round(this.bandwidthReceived);
        }

        getUploadRate() {
            return Number(this.uploadRate.toFixed(2));
        }

        getDownloadRate() {
            return Number(this.downloadRate.toFixed(2));
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

        sendPrivateMessage(args) {
            const targetPlayerID = Number(args.ID);
            if (!Number.isInteger(targetPlayerID) || !this.players.has(targetPlayerID)) return;
            const message = String(args.MESSAGE === undefined ? '' : args.MESSAGE).slice(0, 1000);

            if (this.status === 'Hosting') {
                if (targetPlayerID === Number(this.myPlayerID)) {
                    this.lastPrivateMessage = message;
                    this.lastPrivateMessageSender = Number(this.myPlayerID);
                    this.runtime.startHats('multitools_whenPrivateMessageReceived');
                    return;
                }

                const targetPeerID = this.playerIDToPeer.get(targetPlayerID);
                const connection = targetPeerID && this.connections.get(targetPeerID);
                if (connection && connection.open) {
                    connection.send({
                        type: 'privateMessage',
                        senderPlayerID: Number(this.myPlayerID),
                        message: message
                    });
                }
            } else {
                const host = this.connections.get('Host');
                if (host && host.open) {
                    host.send({
                        type: 'privateMessage',
                        targetPlayerID: targetPlayerID,
                        message: message
                    });
                }
            }
        }

        enablePositionSync(args, util) {
            if (!util || !util.target || util.target.isStage) return;

            this.removeCostumeChangeHook();
            this.syncTarget = util.target;
            this.installCostumeChangeHook();

            // Recreate visible remote players after position sync is enabled.
            for (const [playerID, position] of this.positions) {
                if (Number(playerID) === Number(this.myPlayerID)) continue;
                const drawableID = this.ensureRemoteDrawable(playerID);
                if (drawableID !== null) {
                    // Some remote drawables may have arrived before position sync was enabled.
                    this.placeRemoteDrawableBehindLocal(drawableID);
                    this.updateRemoteDrawable(playerID, drawableID);
                    this.applyRemoteCostume(playerID, drawableID);
                }
            }

            if (this.syncTimer) {
                clearInterval(this.syncTimer);
            }

            // Position updates remain periodic; costume updates are event-driven.
            this.syncTimer = setInterval(() => {
                this.sendCurrentPosition();
            }, 50);

            this.sendCurrentPosition();
            this.sendCurrentCostume();
        }

        hideMeForEveryoneElse() {
            this.showToOthers = false;
            this.sendPlayerVisibility();
        }

        showMeForEveryoneElse() {
            this.showToOthers = true;
            this.sendPlayerVisibility();
        }

        disablePositionSync() {
            if (this.syncTimer) {
                clearInterval(this.syncTimer);
                this.syncTimer = null;
            }

            this.removeCostumeChangeHook();
            this.syncTarget = null;
            this.lastSentPosition = null;
            this.lastSentCostumeKey = null;
        }

        installCostumeChangeHook() {
            if (!this.syncTarget || typeof this.syncTarget.setCostume !== 'function') return;

            const target = this.syncTarget;
            const originalSetCostume = target.setCostume;
            const extension = this;

            const hookedSetCostume = function (...args) {
                const result = originalSetCostume.apply(this, args);
                extension.sendCurrentCostume();
                return result;
            };

            target.setCostume = hookedSetCostume;
            this.costumeChangeHook = {
                target: target,
                original: originalSetCostume,
                hooked: hookedSetCostume
            };
        }

        removeCostumeChangeHook() {
            const hook = this.costumeChangeHook;
            if (!hook) return;

            // Don't overwrite another extension's later wrapper.
            if (hook.target.setCostume === hook.hooked) {
                hook.target.setCostume = hook.original;
            }
            this.costumeChangeHook = null;
        }

        sendCurrentCostume() {
            if (!this.syncTarget || !this.myPlayerID) return;
            if (this.status !== 'Hosting' && this.status !== 'Connected') return;

            const costume = this.syncTarget.sprite.costumes[this.syncTarget.currentCostume];
            if (!costume || !costume.asset) return;
            const format = String(costume.dataFormat || costume.asset.dataFormat || '').toLowerCase();
            if (format !== 'svg') return;

            const assetKey = costume.asset.assetId || costume.md5 || costume.name || '';
            const costumeKey = `${this.syncTarget.currentCostume}:${assetKey}`;
            if (costumeKey === this.lastSentCostumeKey) return;

            let svg;
            try {
                svg = costume.asset.decodeText();
            } catch (error) {
                return;
            }
            if (typeof svg !== 'string' || !svg.trim() || svg.length > 200000) return;

            const data = {
                type: 'costume',
                playerID: Number(this.myPlayerID),
                svg: svg,
                rotationCenterX: Number(costume.rotationCenterX) || 0,
                rotationCenterY: Number(costume.rotationCenterY) || 0
            };

            this.lastSentCostumeKey = costumeKey;

            if (this.status === 'Hosting') {
                this.receiveCostume(this.myPlayerID, data.svg, data.rotationCenterX, data.rotationCenterY);
                this.broadcast(data);
            } else {
                const host = this.connections.get('Host');
                if (host && host.open) host.send(data);
            }
        }

        sendPlayerVisibility() {
            if (!this.myPlayerID ||
                (this.status !== 'Hosting' && this.status !== 'Connected')) return;

            const data = {
                type: 'playerVisibility',
                playerID: this.myPlayerID,
                visible: this.syncTarget ? Boolean(this.syncTarget.visible) : true,
                visibleToOthers: this.showToOthers !== false
            };

            if (this.status === 'Hosting') {
                this.receivePlayerVisibility(this.myPlayerID, data.visible, data.visibleToOthers);
                this.broadcast(data);
            } else {
                const host = this.connections.get('Host');
                if (host && host.open) host.send(data);
            }
        }

        sendCurrentPosition() {
            if (!this.syncTarget || !this.myPlayerID) return;

            if (this.status !== 'Hosting' &&
                this.status !== 'Connected') return;

            const x = Number(this.syncTarget.x);
            const y = Number(this.syncTarget.y);
            const direction = Number(this.syncTarget.direction);
            const size = Number(this.syncTarget.size);
            const visible = Boolean(this.syncTarget.visible);
            const visibleToOthers = this.showToOthers !== false;
            const backdrop = this.getCurrentBackdropName();
            const backdropNumber = this.getCurrentBackdropNumber();
            const visibilityChanged = !this.lastSentPosition ||
                this.lastSentPosition.visible !== visible ||
                this.lastSentPosition.visibleToOthers !== visibleToOthers;

            if (!Number.isFinite(x) || !Number.isFinite(y)) return;

            // Send when position, direction, size, visibility, or backdrop changes.
            if (
                this.lastSentPosition &&
                this.lastSentPosition.x === x &&
                this.lastSentPosition.y === y &&
                this.lastSentPosition.direction === direction &&
                this.lastSentPosition.size === size &&
                this.lastSentPosition.visible === visible &&
                this.lastSentPosition.visibleToOthers === visibleToOthers &&
                this.lastSentPosition.backdrop === backdrop &&
                this.lastSentPosition.backdropNumber === backdropNumber
            ) {
                return;
            }

            this.lastSentPosition = { x, y, direction, size, visible, visibleToOthers, backdrop, backdropNumber };

            const data = {
                type: 'position',
                playerID: this.myPlayerID,
                x: x,
                y: y,
                direction: direction,
                size: size,
                visible: visible,
                visibleToOthers: visibleToOthers,
                backdrop: backdrop,
                backdropNumber: backdropNumber
            };

            if (this.status === 'Hosting') {
                this.receivePosition(this.myPlayerID, x, y, direction, size, visible, visibleToOthers, backdrop, backdropNumber);
                this.broadcast(data);
            } else {
                const host = this.connections.get('Host');

                if (host && host.open) {
                    host.send(data);
                }
            }

            // Keep visibility on its own channel so it cannot be lost with position updates.
            if (visibilityChanged) this.sendPlayerVisibility();
        }

        disconnect() {
            this.isDisconnecting = true;
            this.disablePositionSync();

            const renderer = this.runtime && this.runtime.renderer;
            if (renderer && typeof renderer.destroyDrawable === 'function') {
                for (const drawableID of this.remoteDrawables.values()) {
                    renderer.destroyDrawable(drawableID);
                }
            }
            this.remoteDrawables.clear();

            for (const skinId of this.remoteSkinIds.values()) {
                this.runtime.renderer.destroySkin(skinId);
            }
            this.remoteSkinIds.clear();
            this.costumes.clear();

            if (this.soloLobbyTimer) {
                clearTimeout(this.soloLobbyTimer);
                this.soloLobbyTimer = null;
            }
            if (this.migrationTimer) {
                clearTimeout(this.migrationTimer);
                this.migrationTimer = null;
            }
            this.migrationInProgress = false;

            for (const connection of this.connections.values()) {
                try {
                    connection.close();
                } catch (error) {}
            }

            this.connections.clear();
            this.players.clear();
            this.positions.clear();
            this.pingValues.clear();
            this.pendingPings.clear();
            this.playerLists.clear();
            this.bandwidthBaselines.clear();
            if (this.pingTimer) {
                clearInterval(this.pingTimer);
                this.pingTimer = null;
            }
            if (this.bandwidthTimer) {
                clearInterval(this.bandwidthTimer);
                this.bandwidthTimer = null;
            }
            this.bandwidthSent = 0;
            this.bandwidthReceived = 0;
            this.uploadRate = 0;
            this.downloadRate = 0;
            this.peerToPlayerID.clear();
            this.playerIDToPeer.clear();

            if (this.peer) {
                try {
                    this.peer.destroy();
                } catch (error) {}
            }

            this.peer = null;
            this.roomID = '';
            this.peerID = '';
            this.roomLocked = false;
            this.updateDashboard();
            this.myPlayerID = '';
            this.status = 'Disconnected';
            this.updateDashboard();

            this.lastPositionPlayerID = '';
            this.lastJoinedPlayerID = '';
        }

        getMessage() {
            return this.lastMessage;
        }

        getPrivateMessage() {
            return this.lastPrivateMessage;
        }

        getPrivateMessageSender() {
            return this.lastPrivateMessageSender;
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
            const position = this.positions.get(Number(args.ID));
            return position ? position.x : 0;
        }

        getPlayerY(args) {
            const position = this.positions.get(Number(args.ID));
            return position ? position.y : 0;
        }

        getBackdropName(args) {
            const position = this.positions.get(Number(args.ID));
            return position && typeof position.backdrop === 'string'
                ? position.backdrop
                : '';
        }

        getBackdropNumber(args) {
            const position = this.positions.get(Number(args.ID));
            return position && Number.isFinite(position.backdropNumber)
                ? position.backdropNumber
                : 0;
        }

        getPlayerDirection(args) {
            const position = this.positions.get(Number(args.ID));
            return position && Number.isFinite(position.direction)
                ? position.direction
                : 0;
        }

        getPlayerSize(args) {
            const position = this.positions.get(Number(args.ID));
            return position && Number.isFinite(position.size)
                ? position.size
                : 0;
        }

        getPlayerVisible(args) {
            const position = this.positions.get(Number(args.ID));
            return position ? position.visible !== false : false;
        }

        getPlayerVisibleToOthers(args) {
            const position = this.positions.get(Number(args.ID));
            return position ? position.visibleToOthers !== false : false;
        }
    }

    Scratch.extensions.register(new MultiTools());
})(Scratch);
