/**
 * Whisper comments system
 */

"use strict";

var BigNumber = require("bignumber.js");
var errors = require("./errors");
var constants = require("./constants");
var utilities = require("./utilities");
var numeric = require("./numeric");

module.exports = function (augur) {

    return {

        // key: marketId => {filterId: hexstring, polling: bool}
        filters: {},

        db: {

            write: function (handle, data, f) {
                try {
                    return augur.rpc.json_rpc(augur.rpc.postdata(
                        "putString",
                        ["comments", handle, data],
                        "db_"
                    ), f);
                } catch (e) {
                    return errors.DB_WRITE_FAILED;
                }
            },

            get: function (handle, f) {
                try {
                    return augur.rpc.json_rpc(augur.rpc.postdata(
                        "getString",
                        ["comments", handle],
                        "db_"
                    ), f);
                } catch (e) {
                    return errors.DB_READ_FAILED;
                }
            }
        },

        getMessages: function (filter, f) {
            return augur.rpc.json_rpc(augur.rpc.postdata("getMessages", filter, "shh_"), f);
        },

        getFilterChanges: function (filter, f) {
            return augur.rpc.json_rpc(augur.rpc.postdata("getFilterChanges", filter, "shh_"), f);
        },

        newIdentity: function (f) {
            return augur.rpc.json_rpc(augur.rpc.postdata("newIdentity", null, "shh_"), f);
        },

        post: function (params, f) {
            return augur.rpc.json_rpc(augur.rpc.postdata("post", params, "shh_"), f);
        },

        whisperFilter: function (params, f) {
            return augur.rpc.json_rpc(augur.rpc.postdata("newFilter", params, "shh_"), f);
        },

        commentFilter: function (market, f) {
            return this.whisperFilter({ topics: [ market ]}, f);
        },

        uninstallFilter: function (filter, f) {
            return augur.rpc.json_rpc(augur.rpc.postdata("uninstallFilter", filter, "shh_"), f);
        },

        /**
         * Incoming comment filter:
         *  - compare comment string length, write the longest to leveldb
         *  - 10 second ethereum network polling interval
         */
        pollFilter: function (market_id, filter_id) {
            var self = this;
            var incoming_comments, stored_comments, num_messages, incoming_parsed, stored_parsed;
            this.getFilterChanges(filter_id, function (message) {
                if (message) {
                    num_messages = message.length;
                    if (num_messages) {
                        for (var i = 0; i < num_messages; ++i) {
                            // log("\n\nPOLLFILTER: reading incoming message " + i.toString());
                            incoming_comments = augur.abi.decode_hex(message[i].payload);
                            if (incoming_comments) {
                                incoming_parsed = JSON.parse(incoming_comments);
                                // log(incoming_parsed);
                    
                                // get existing comment(s) stored locally
                                stored_comments = self.db.get(market_id);

                                // check if incoming comments length > stored
                                if (stored_comments && stored_comments.length) {
                                    stored_parsed = JSON.parse(stored_comments);
                                    if (incoming_parsed.length > stored_parsed.length ) {
                                        // log(incoming_parsed.length.toString() + " incoming comments");
                                        // log("[" + filter_id + "] overwriting comments for market: " + market_id);
                                        if (self.db.write(market_id, incoming_comments)) {
                                            // log("[" + filter_id + "] overwrote comments for market: " + market_id);
                                        }
                                    } else {
                                        // log(stored_parsed.length.toString() + " stored comments");
                                        // log("[" + filter_id + "] retaining comments for market: " + market_id);
                                    }
                                } else {
                                    // log(incoming_parsed.length.toString() + " incoming comments");
                                    // log("[" + filter_id + "] inserting first comments for market: " + market_id);
                                    if (self.db.write(market_id, incoming_comments)) {
                                        // log("[" + filter_id + "] overwrote comments for market: " + market_id);
                                    }
                                }
                            }
                        }
                    }
                }
                // wait a few seconds, then poll the filter for new messages
                setTimeout(function () {
                    self.pollFilter(market_id, filter_id);
                }, constants.COMMENT_POLL_INTERVAL);
            });
        },

        initComments: function (market) {
            var filter, comments, whisper_id;

            // make sure there's only one shh filter per market
            if (this.filters[market] && this.filters[market].filterId) {
                // log("existing filter found");
                this.pollFilter(market, this.filters[market].filterId);
                return this.filters[market].filterId;

            // create a new shh filter for this market
            } else {
                filter = this.commentFilter(market);
                if (filter && filter !== "0x") {
                    // log("creating new filter");
                    this.filters[market] = {
                        filterId: filter,
                        polling: true
                    };

                    // broadcast all comments in local leveldb
                    comments = this.db.get(market);
                    if (comments) {
                        whisper_id = this.newIdentity();
                        if (whisper_id) {
                            var transmission = {
                                from: whisper_id,
                                topics: [market],
                                payload: numeric.prefix_hex(numeric.encode_hex(comments)),
                                priority: "0x64",
                                ttl: "0x500" // time-to-live (until expiration) in seconds
                            };
                            if (!this.post(transmission)) {
                                return errors.WHISPER_POST_FAILED;
                            }
                        }
                    }
                    this.pollFilter(market, filter);
                    return filter;
                }
            }
        },

        resetComments: function (market) {
            return this.db.write(market, "");
        },

        getMarketComments: function (market) {
            var comments = this.db.get(market);
            if (comments) {
                return JSON.parse(comments);
            } else {
                return null;
            }
        },

        addMarketComment: function (pkg) {
            var market, comment_text, author, updated, transmission, whisper_id, comments;
            market = pkg.marketId;
            comment_text = pkg.message;
            author = pkg.author || augur.coinbase;

            whisper_id = this.newIdentity();
            if (whisper_id && !whisper_id.error) {
                updated = JSON.stringify([{
                    whisperId: whisper_id,
                    from: author, // ethereum account
                    comment: comment_text,
                    time: Math.floor((new Date()).getTime() / 1000)
                }]);

                // get existing comment(s) stored locally
                // (note: build with DFATDB=1 if DBUNDLE=minimal)
                comments = this.db.get(market);
                if (comments && comments !== '""') {
                    // console.log("stored:", comments);
                    // console.log("incoming:", updated);
                    updated = updated.slice(0,-1) + "," + comments.slice(1);
                    // console.log("concat:", updated);
                }
                if (this.db.write(market, updated)) {
                    transmission = {
                        from: whisper_id,
                        topics: [market],
                        payload: numeric.prefix_hex(numeric.encode_hex(updated)),
                        priority: "0x64",
                        ttl: "0x600" // 10 minutes
                    };
                    if (this.post(transmission)) {
                        var decoded = numeric.decode_hex(transmission.payload);
                        return JSON.parse(decoded.slice(1));
                    } else {
                        return errors.WHISPER_POST_FAILED;
                    }
                } else {
                    return errors.DB_WRITE_FAILED;
                }
            } else {
                return whisper_id;
            }
        }

    };
};
