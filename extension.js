
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
            this.remoteSprites = new Map();
            this.remoteSkinIds = new Map();
            this.costumes = new Map();

            this.roomID = '';
            this.status = 'Disconnected';
            this.peerID = '';
            this.myPlayerID = '';
            this.peerToPlayerID = new Map();
            this.playerIDToPeer = new Map();

            this.lastMessage = '';
            this.lastJoinedPlayerID = '';
            this.lastPositionPlayerID = '';

            this.syncTarget = null;
            this.syncTimer = null;
            this.lastSentPosition = null;
            this.lastSentCostumeKey = null;
            this.soloLobbyTimer = null;

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
                    this.peerID = id;
                    this.myPlayerID = 1;
                    this.players = new Set([1]);
                    this.peerToPlayerID.clear();
                    this.playerIDToPeer.clear();
                    this.peerToPlayerID.set(id, 1);
                    this.playerIDToPeer.set(1, id);
                    this.status = 'Hosting';
                    this.updateSoloLobbyTimer();
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
                        this.sendCurrentPosition();
                        this.sendCurrentCostume();
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
                const peerID = connection.peer;
                const playerID = this.getNextPlayerID();

                this.connections.set(peerID, connection);
                this.peerToPlayerID.set(peerID, playerID);
                this.playerIDToPeer.set(playerID, peerID);
                this.players.add(playerID);
                this.updateSoloLobbyTimer();

                connection.send({
                    type: 'welcome',
                    playerID: playerID,
                    hostID: 1,
                    players: Array.from(this.players),
                    positions: Array.from(this.positions.entries())
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
                    this.players.delete(playerID);
                    this.positions.delete(playerID);
                    this.costumes.delete(playerID);
                    this.removeRemoteSprite(playerID);

                    this.broadcast({
                        type: 'playerLeft',
                        playerID: playerID
                    });
                }
                this.updateSoloLobbyTimer();
            });
        }

        handleData(data, senderID) {
            if (!data || typeof data !== 'object') return;

            if (data.type === 'welcome') {
                this.myPlayerID = Number(data.playerID);
                this.players = new Set(data.players || []);
                this.players.add(this.myPlayerID);

                if (data.hostID) this.players.add(Number(data.hostID));

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

            if (data.type === 'position') {
                const playerID = senderID === 'Host'
                    ? Number(data.playerID)
                    : this.peerToPlayerID.get(senderID);

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
                this.players.add(Number(data.playerID));
                this.lastJoinedPlayerID = Number(data.playerID);

                this.runtime.startHats(
                    'multitools_whenPlayerJoins'
                );

                return;
            }

            if (data.type === 'playerLeft') {
                this.players.delete(Number(data.playerID));
                this.positions.delete(Number(data.playerID));
                this.costumes.delete(Number(data.playerID));
                this.removeRemoteSprite(data.playerID);
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

        ensureRemoteSprite(playerID) {
            const numericID = Number(playerID);
            if (!Number.isFinite(numericID) || numericID <= 0 ||
                numericID === Number(this.myPlayerID) || !this.syncTarget) return null;

            let remoteSprite = this.remoteSprites.get(numericID);
            if (remoteSprite && !remoteSprite.isDisposed) return remoteSprite;

            // Use this project's synced sprite as the visual template for now.
            remoteSprite = this.syncTarget.makeClone();
            if (!remoteSprite) return null;

            remoteSprite.visible = true;
            this.runtime.addTarget(remoteSprite);
            remoteSprite.goBehindOther(this.syncTarget);
            this.remoteSprites.set(numericID, remoteSprite);
            return remoteSprite;
        }

        applyRemoteCostume(playerID, remoteSprite) {
            const costumeData = this.costumes.get(Number(playerID));
            if (!costumeData || !remoteSprite || remoteSprite.drawableID === null || remoteSprite.drawableID === undefined) return;

            const renderer = this.runtime.renderer;
            if (!renderer || typeof renderer.createSVGSkin !== 'function') return;

            const skinId = renderer.createSVGSkin(costumeData.svg, [
                costumeData.rotationCenterX,
                costumeData.rotationCenterY
            ]);
            if (skinId === null || skinId === undefined) return;

            renderer.updateDrawableSkinId(remoteSprite.drawableID, skinId);
            remoteSprite.emitVisualChange();
            this.runtime.requestRedraw();

            const oldSkinId = this.remoteSkinIds.get(Number(playerID));
            this.remoteSkinIds.set(Number(playerID), skinId);
            if (oldSkinId !== undefined) renderer.destroySkin(oldSkinId);
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

            const remoteSprite = this.ensureRemoteSprite(numericID);
            if (remoteSprite) this.applyRemoteCostume(numericID, remoteSprite);
        }

        removeRemoteSprite(playerID) {
            const numericID = Number(playerID);
            const remoteSprite = this.remoteSprites.get(numericID);
            if (remoteSprite) {
                this.runtime.disposeTarget(remoteSprite);
                this.remoteSprites.delete(numericID);
            }

            const skinId = this.remoteSkinIds.get(numericID);
            if (skinId !== undefined) {
                this.runtime.renderer.destroySkin(skinId);
                this.remoteSkinIds.delete(numericID);
            }
        }

        receivePosition(playerID, x, y) {
            const numericID = Number(playerID);
            if (!Number.isFinite(numericID) || numericID <= 0) return;
            if (!Number.isFinite(Number(x)) ||
                !Number.isFinite(Number(y))) return;

            const position = {
                x: Number(x),
                y: Number(y)
            };

            this.positions.set(numericID, position);
            this.players.add(numericID);
            this.lastPositionPlayerID = numericID;

            if (numericID !== Number(this.myPlayerID)) {
                const remoteSprite = this.ensureRemoteSprite(numericID);
                if (remoteSprite) remoteSprite.setXY(position.x, position.y);
            }

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

            // Recreate visible remote players after position sync is enabled.
            for (const [playerID, position] of this.positions) {
                if (Number(playerID) === Number(this.myPlayerID)) continue;
                const remoteSprite = this.ensureRemoteSprite(playerID);
                if (remoteSprite) {
                    remoteSprite.setXY(position.x, position.y);
                    this.applyRemoteCostume(playerID, remoteSprite);
                }
            }

            if (this.syncTimer) {
                clearInterval(this.syncTimer);
            }

            // Send the sprite's position 20 times per second.
            this.syncTimer = setInterval(() => {
                this.sendCurrentPosition();
                this.sendCurrentCostume();
            }, 50);

            this.sendCurrentPosition();
            this.sendCurrentCostume();
        }

        disablePositionSync() {
            if (this.syncTimer) {
                clearInterval(this.syncTimer);
                this.syncTimer = null;
            }

            this.syncTarget = null;
            this.lastSentPosition = null;
            this.lastSentCostumeKey = null;
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

            for (const remoteSprite of this.remoteSprites.values()) {
                this.runtime.disposeTarget(remoteSprite);
            }
            this.remoteSprites.clear();

            for (const skinId of this.remoteSkinIds.values()) {
                this.runtime.renderer.destroySkin(skinId);
            }
            this.remoteSkinIds.clear();
            this.costumes.clear();

            if (this.soloLobbyTimer) {
                clearTimeout(this.soloLobbyTimer);
                this.soloLobbyTimer = null;
            }

            for (const connection of this.connections.values()) {
                try {
                    connection.close();
                } catch (error) {}
            }

            this.connections.clear();
            this.players.clear();
            this.positions.clear();
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
            const position = this.positions.get(Number(args.ID));
            return position ? position.x : 0;
        }

        getPlayerY(args) {
            const position = this.positions.get(Number(args.ID));
            return position ? position.y : 0;
        }
    }

    Scratch.extensions.register(new MultiTools());
})(Scratch);
