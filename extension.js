
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
            this.costumeChangeHook = null;
            this.soloLobbyTimer = null;

            this.dashboardElement = null;
            this.dashboardVisible = false;
            this.maxPlayers = 8;
            this.roomLocked = false;

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
                    this.updateDashboard();
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
                const playerID = this.getNextPlayerID();

                this.connections.set(peerID, connection);
                this.peerToPlayerID.set(peerID, playerID);
                this.playerIDToPeer.set(playerID, peerID);
                this.players.add(playerID);
                this.updateSoloLobbyTimer();
                this.updateDashboard();

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
            if (this.dashboardPlayers) {
                this.dashboardPlayers.textContent = '';
                const ids = Array.from(this.players).sort((a, b) => Number(a) - Number(b));
                ids.forEach(playerID => {
                    const row = document.createElement('div');
                    row.className = 'mt-row mt-player';
                    const name = document.createElement('span');
                    name.textContent = 'Player ' + playerID + (Number(playerID) === 1 ? ' (Host)' : '');
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

            this.removeCostumeChangeHook();
            this.syncTarget = util.target;
            this.installCostumeChangeHook();

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

            // Position updates remain periodic; costume updates are event-driven.
            this.syncTimer = setInterval(() => {
                this.sendCurrentPosition();
            }, 50);

            this.sendCurrentPosition();
            this.sendCurrentCostume();
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
