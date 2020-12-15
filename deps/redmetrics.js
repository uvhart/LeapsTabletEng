// Uses AMD or browser globals to create a module.

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(["q-xhr"], factory);
    } else {
        // Browser globals
        root.redmetrics = factory(root.b);
    }
}(this, function (b) {
    var redmetrics = {};

    redmetrics.prepareWriteConnection = function(connectionOptions) {
        var eventQueue = [];
        var snapshotQueue = [];
        var postDeferred = Q.defer();
        var timerId = null;
        var connectionPromise = null;

        // This data structure will be returned from the prepareWriteConnection() function
        var writeConnection = {
            connected: false,
            playerId: null,
            playerInfo: {},
            // Get options passed to the factory. Works even if connectionOptions is undefined 
            options: _.defaults({}, connectionOptions, {
                protocol: "https",
                host: "api.redmetrics.io",
                port: 443,
                bufferingDelay: 5000,
                player: {}
            }),
        };

        // Build base URL
        if(!writeConnection.options.baseUrl) {
            writeConnection.options.baseUrl = writeConnection.options.protocol + "://" + writeConnection.options.host + ":" + writeConnection.options.port;
        }

        if(!writeConnection.options.gameVersionId) {
            throw new Error("Missing options.gameVersionId");
        }


        function getUserTime() {
            return new Date().toISOString();
        }

        function sendData() {
            if(eventQueue.length == 0 && snapshotQueue.length == 0) return;

            Q.spread([sendEvents(), sendSnapshots()], function(eventCount, snaphotCount) {
                postDeferred.resolve({
                    events: eventCount,
                    snapshots: snaphotCount
                });
            }).fail(function(error) {
                postDeferred.reject(new Error("Error posting data: " + error));
            }).fin(function() {
                // Create new deferred
                postDeferred = Q.defer();
            });
        }

        function sendEvents() {
            if(eventQueue.length == 0) return Q.fcall(function() { 
                return 0; 
            });

            // Add data related to current connection
            for(var i = 0; i < eventQueue.length; i++) {
                _.extend(eventQueue[i], {
                    gameVersion: writeConnection.options.gameVersionId,
                    player: writeConnection.playerId,
                });
            }

            var request = Q.xhr({
                url: writeConnection.options.baseUrl + "/v1/event/",
                method: "POST",
                data: JSON.stringify(eventQueue),
                contentType: "application/json"
            }).then(function(result) {
               return result.data.length;
            }).fail(function(error) {
                throw new Error("Error posting events: " + error);
            });

            // Clear queue
            eventQueue = [];

            return request;
        }

        function sendSnapshots() {
            if(snapshotQueue.length == 0) return Q.fcall(function() { 
                return 0; 
            });

            // Add data related to current connection
            for(var i = 0; i < snapshotQueue.length; i++) {
                _.extend(snapshotQueue[i], {
                    gameVersion: writeConnection.options.gameVersionId,
                    player: writeConnection.playerId,
                });
            }

            var request = Q.xhr({
                url: writeConnection.options.baseUrl + "/v1/snapshot/",
                method: "POST",
                data: JSON.stringify(snapshotQueue),
                contentType: "application/json"
            }).then(function(result) {
                return result.data.length;
            }).fail(function(error) {
                throw new Error("Error posting snapshots: " + error);
            });

            // Clear queue
            snapshotQueue = [];

            return request;
        }

        writeConnection.connect = function() {
            if(writeConnection.connected) throw new Error("writeConnection is already connected. Call writeConnection.disconnect() before connecting again.");

            _.extend(writeConnection.options.player, writeConnection.playerInfo);

            // The player info may change during the connection process, so hold onto it
            var oldPlayerInfo = writeConnection.playerInfo;

            function getStatus() {
                return Q.xhr.get(writeConnection.options.baseUrl + "/status").fail(function(error) {
                    writeConnection.connected = false;
                    throw new Error("Cannot connect to writeConnection server", writeConnection.options.baseUrl);
                });
            }

            function checkGameVersion() {
                return Q.xhr.get(writeConnection.options.baseUrl + "/v1/gameVersion/" + writeConnection.options.gameVersionId).fail(function(error) {
                    writeConnection.connected = false;
                    throw new Error("Invalid gameVersionId");
                });
            }

            function createPlayer() {
                var playerInfo = writeConnection.options.player;

                // Currently redmetrics requires customData to be encoded as a string
                if(_.has(playerInfo, "customData")) {
                    // Clone object to avoid modifying writeConnection.playerInfo
                    playerInfo = _.clone(playerInfo);
                    playerInfo.customData = JSON.stringify(playerInfo.customData);
                }

                return Q.xhr({
                    url: writeConnection.options.baseUrl + "/v1/player/",
                    method: "POST",
                    data: JSON.stringify(playerInfo),
                    contentType: "application/json"
                }).then(function(result) {
                    writeConnection.playerId = result.data.id;
                }).fail(function(error) {
                    writeConnection.connected = false;
                    throw new Error("Cannot create player: " + error);
                });
            }

            function establishConnection() {
                writeConnection.connected = true;

                // Start sending events
                timerId = window.setInterval(sendData, writeConnection.options.bufferingDelay);

                // If the playerInfo has been modified during the connection process, call updatePlayer()
                if(oldPlayerInfo != writeConnection.playerInfo) return writeConnection.updatePlayer(writeConnection.playerInfo);
            }   

            // Hold on to connection promise so that other functions may listen to it
            connectionPromise = getStatus().then(checkGameVersion).then(createPlayer).then(establishConnection);
            return connectionPromise;
        };

        writeConnection.disconnect = function() {
            function resetState() {
                writeConnection.playerId = null;
                connectionPromise = null;

                writeConnection.connected = false;
            }

            // Stop timer
            if(timerId) {
                window.clearInterval(timerId);
                timerId = null;
            }

            if(connectionPromise) {
                // Flush any remaining data
                return connectionPromise.then(sendData).fin(resetState);
            } else {
                return Q.fcall(resetState);
            }
        };

        writeConnection.postEvent = function(event) {
            if(event.section && _.isArray(event.section)) {
                event.section = event.section.join(".");
            }

            eventQueue.push(_.extend(event, {
                userTime: getUserTime()
            }));

            return postDeferred.promise;
        };

        writeConnection.postSnapshot = function(snapshot) {
            if(snapshot.section && _.isArray(snapshot.section)) {
                snapshot.section = snapshot.section.join(".");
            }

            snapshotQueue.push(_.extend(snapshot, {
                userTime: getUserTime()
            }));

            return postDeferred.promise;
        };

        writeConnection.updatePlayer = function(playerInfo) {
            writeConnection.playerInfo = playerInfo;

            // If we're not yet connected, return immediately
            if(!writeConnection.connected) return Q(writeConnection.playerInfo); 

            // Currently redmetrics requires customData to be encoded as a string
            if(_.has(playerInfo, "customData")) {
                // Clone object to avoid modifying writeConnection.playerInfo
                playerInfo = _.clone(playerInfo);
                playerInfo.customData = JSON.stringify(playerInfo.customData);
            }

            // Otherwise update on the server
            return Q.xhr({
                url: writeConnection.options.baseUrl + "/v1/player/" + writeConnection.playerId,
                method: "PUT",
                data: JSON.stringify(playerInfo),
                contentType: "application/json"
            }).then(function() {
                return writeConnection.playerInfo;
            }).fail(function(error) {
                throw new Error("Cannot update player:", error)
            });
        }

        return writeConnection;
    }

    function formatDateAsIso(dateString) {
        if(!dateString) return null;

        // Read as local date but convert to UTC time
        var localDate = new Date(dateString);
        var utcDate = Date.UTC(localDate.getFullYear(), localDate.getMonth(), 
            localDate.getDate(), localDate.getHours(), localDate.getMinutes(), 
            localDate.getSeconds(), localDate.getMilliseconds());
        return new Date(utcDate).toISOString();
    }

    function readDateAsIso(dateString) {
        if(!dateString) return null;

        // Read as utc date but pretend it is a local date
        var localDate = new Date(dateString);
        return new Date(localDate.getUTCFullYear(), localDate.getUTCMonth(), 
            localDate.getUTCDate(), localDate.getUTCHours(), localDate.getUTCMinutes(), 
            localDate.getUTCSeconds(), localDate.getUTCMilliseconds());
    }

    /*  The _connectionOptions_ object contains:
            * Either _baseUrl_ (like "https://api.redmetrics.api" or the following 
                *   protocol
                *   host
                *   port
            * gameVersionId
        The _searchFilter_ object contains:
            * game
            * gameVersion
            * playerId
            * entityType ("event" or "snapshot")
            * type
            * section
            * before
            * after
            * beforeUserTime
            * afterUserTime
            * page
            * perPage
    */
    redmetrics.executeQuery = function(searchFilter, connectionOptions) {
        _.defaults({}, connectionOptions, {
            protocol: "https",
            host: "api.writeConnection.io",
            port: 443
        });

        // Build base URL
        if(!connectionOptions.baseUrl) {
            connectionOptions.baseUrl = connectionOptions.protocol + "://" + connectionOptions.host + ":" + connectionOptions.port;
        }

        if(!searchFilter.entityType) {
            throw new Error("Missing entityType");
        }

        // Copy over searchFilter
        var newSearchFilter = _.clone(searchFilter);

        // Convert date search filters 
        var dateFilterParams = ["after", "before", "beforeUserTime", "afterUserTime"];
        _.each(dateFilterParams, function(param) {
            if(_.has(searchFilter, param)) {
                newSearchFilter[param] = formatDateAsIso(searchFilter[param]);
            }
        });

        // Make request
        return Q.xhr.get(connectionOptions.baseUrl + "/v1/" + newSearchFilter.entityType, { params: newSearchFilter })
        .then(function(response) {
            var headers = response.headers();
            var result = {
                // Extract page info from headers
                pageNumber: parseInt(headers["x-page-number"]),
                pageCount: parseInt(headers["x-page-count"]),
                perPageCount: parseInt(headers["x-per-page-count"]),
                totalCount: parseInt(headers["x-total-count"]),

                // Copy over original options
                connectionOptions: connectionOptions,
                searchFilter: searchFilter,

                // Convert times in the data
                data: _.each(response.data, function(entity) {
                    entity.serverTime = readDateAsIso(entity.serverTime);
                    if(entity.userTime) {
                        entity.userTime = readDateAsIso(entity.userTime);
                    }
                }),

                // Add helper alias functions
                hasNextPage: function() { return redmetrics.hasNextPage(result); },
                hasPreviousPage: function() { return redmetrics.hasPreviousPage(result); },
                nextPage: function() { return redmetrics.nextPage(result); },
                previousPage: function() { return redmetrics.previousPage(result); },
            };
            return result;
        });
    }

    redmetrics.hasNextPage = function(queryResult) {
        return queryResult.pageNumber < queryResult.pageCount;
    }

    redmetrics.hasPreviousPage = function(queryResult) {
        return queryResult.pageNumber > 1;
    }

    redmetrics.nextPage = function(queryResult) {
        var newSearchFilter = _.extend({}, queryResult.searchFilter, {
            page: queryResult.pageNumber + 1
        });
        return redmetrics.executeQuery(newSearchFilter, queryResult.connectionOptions);
    }

    redmetrics.previousPage = function(queryResult) {
        if(!redmetrics.hasPreviousPage(queryResult)) throw new Error("There is no previous page");

        var newSearchFilter = _.extend({}, queryResult.searchFilter, {
            page: queryResult.pageNumber - 1
        });
        return redmetrics.executeQuery(newSearchFilter, queryResult.connectionOptions);
    }

    return redmetrics;
}));

