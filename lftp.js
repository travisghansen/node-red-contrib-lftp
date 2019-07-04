module.exports = function(RED) {
  "use strict";
  var fs = require("fs");
  var FTPS = require("ftps");
  var Parser = require("parse-listing");
  var tmp = require("tmp");
  var utils = require("./utils");

  function LftpConfigNode(n) {
    RED.nodes.createNode(this, n);

    this.options = {
        host: n.host || "localhost", // required
        protocol: n.protocol || "ftp", // Optional, values : 'ftp', 'sftp', 'ftps', ... default: 'ftp'
        // protocol is added on beginning of host, ex : sftp://domain.com in this case
        port: n.port || 21, // Optional
        // port is added to the end of the host, ex: sftp://domain.com:22 in this case
        escape: n.escape || true, // optional, used for escaping shell characters (space, $, etc.), default: true
        retries: n.retries || 2, // Optional, defaults to 1 (1 = no retries, 0 = unlimited retries)
        timeout: n.timeout || 10, // Optional, Time before failing a connection attempt. Defaults to 10
        retryInterval: n.retryInterval || 5, // Optional, Time in seconds between attempts. Defaults to 5
        retryMultiplier: n.retryMultiplier || 1, // Optional, Multiplier by which retryInterval is multiplied each time new attempt fails. Defaults to 1
        requiresPassword: n.requiresPassword || false, // Optional, defaults to true
        autoConfirm: false, // Optional, is used to auto confirm ssl questions on sftp or fish protocols, defaults to false
        cwd: "", // Optional, defaults to the directory from where the script is executed
        additionalLftpCommands: n.additionalLftpCommands || "", // Additional commands to pass to lftp, splitted by ';'
        requireSSHKey: false, //  Optional, defaults to false, This option for SFTP Protocol with ssh key authentication
        sshKeyPath: "/path/id_dsa" // Required if requireSSHKey: true , defaults to empty string, This option for SFTP Protocol with ssh key authentication
    };

    this.options.username = "";
    this.options.password = "";
    if (this.credentials && this.credentials.hasOwnProperty("username")) {
        this.options.username = this.credentials.username;
    }
    if (this.credentials && this.credentials.hasOwnProperty("password")) {
        this.options.password = this.credentials.password;
    }
  }

  RED.nodes.registerType("lftp-config", LftpConfigNode, {
    credentials: {
        username: { type: "text" },
        password: { type: "password" }
    }
  });

  function LftpCommandNode(n) {
    RED.nodes.createNode(this, n);
    var node = this;
    this.server = n.server;
    this.operation = n.operation;
    this.filename = n.filename;
    this.localFilename = n.localFilename;
    this.workdir = n.workdir;
    this.savedir = n.savedir;
    this.serverConfig = RED.nodes.getNode(this.server);
    //this.credentials = RED.nodes.getCredentials(this.server);

    var statuses = {
        active: { fill: "blue", shape: "dot", text: "executing" },
        error: { fill: "red", shape: "dot", text: "error" },
        blank: {}
    };

    /**
     * Returns true if the reponse is an error, false otherwise
     *
     * @param {*} err
     * @param {*} res
     */
    var responseErrorHandler = function(err, res, msg) {
        const message = null;
        try 
        {
            if (err) 
            {
                message = err;
            }
            else if (res.error && res.error.toLowerCase().includes("error"))
            {
                // When disk is readonly, the output from lftp goes to stderr.
                // so lets filter this by checking if the string contains
                // any kind of error.
                // try catch in the case that res.error is not a string.
                message = res.error;
            }
        }
        catch(e)
        {
            // silently fail and continue
        }

        if (message) {
            node.error(message, msg);
            node.status(statuses.error);
            return true;
        } else {
            return false;
        }
    };

    this.commands = {};
    this.commands.list = function(event, msg)
    {
        var conn = new FTPS(node.serverConfig.options);
        conn.cd(event.workdir)
            .ls()
            .exec(function(err, res) {
                if (!responseErrorHandler(err, res, msg)) {
                    Parser.parseEntries(res.data, function(err, data) {
                        msg.workdir = event.workdir;
                        msg.payload = data;
                        node.send(msg);
                        node.status(statuses.blank);
                    });
                }
            });
    };

    this.commands.get = function(event, msg)
    {
        var filename =
        utils.addTrailingSlash(event.workdir) + event.filename;

        var conn = new FTPS(node.serverConfig.options);
        conn.cat(filename).exec(function(err, res) {
            if (!responseErrorHandler(err, res, msg)) {
                msg.workdir = event.workdir;
                msg.payload = {};
                msg.payload.filedata = res.data;
                msg.payload.filename = event.filename;
                msg.payload.filepath = filename;
                node.send(msg);
                node.status(statuses.blank);
            }
        });
    };

    this.commands.put = function(event, msg)
    {
        if (!event.filename.length > 0) {
            var d = new Date();
            var guid = d.getTime().toString();

            if (event.fileExtension == "") {
              event.fileExtension = ".txt";
            }

            event.filename = guid + node.fileExtension;
        }

        var filename =
            utils.addTrailingSlash(event.workdir) + event.filename;
        var filedata =
            msg.payload.filedata || JSON.stringify(msg.payload);
        var sourcefile =
            event.localFilename;


        if (sourcefile) 
        {
            node.debug("putting " + sourcefile + " directly");
            // If we have a sourcefile instead of file data, we can just
            // directly give this file to FPTS
            var conn = new FTPS(node.serverConfig.options);
            conn.put(sourcefile, filename).exec(function(err, res) {
                if (!responseErrorHandler(err, res, msg)) {
                    msg.workdir = event.workdir;
                    msg.payload = {};
                    msg.payload.filename = event.filename;
                    msg.payload.filepath = filename;
                    node.send(msg);
                    node.status(statuses.blank);
                }
            });
        } 
        else if (filedata)
        {
            node.debug("putting " + filedata + " temporarily");
            // If we don't have a sourcefile, we will have to make a
            // temporary file because lftp can't stream data directly.
            // This file is temporarily written to disk, put, then 
            // deleted locally.
            tmp.file(function(err, path, fd, cleanupCallback) {
                if (err) throw err;
    
                fs.writeFile(path, filedata, function(err) {
                    if (err) {
                        cleanupCallback();
                        throw err;
                    }
    
                    var conn = new FTPS(node.serverConfig.options);
                    conn.put(path, filename).exec(function(err, res) {

                    cleanupCallback();
                    if (!responseErrorHandler(err, res, msg)) {
                        msg.workdir = event.workdir;
                        msg.payload = {};
                        msg.payload.filename = event.filename;
                        msg.payload.filepath = filename;
                        node.send(msg);
                        node.status(statuses.blank);
                    }
                    });
                });
            });
        }
        else
        {
            // Nothing to write!
            node.error("nothing to write", msg);
            node.status(statuses.error);
        }
    };

    this.commands.delete = function(event, msg)
    {
        var filename =
        utils.addTrailingSlash(event.workdir) + event.filename;

        var conn = new FTPS(node.serverConfig.options);
        conn.rm(filename).exec(function(err, res) {
            if (!responseErrorHandler(err, res, msg)) {
                msg.workdir = event.workdir;
                msg.payload = {};
                msg.payload.filename = event.filename;
                msg.payload.filepath = filename;
                node.send(msg);
                node.status(statuses.blank);
            }
        });
    };

    this.commands.rmdir = function(event, msg)
    {
        var filename =
        utils.addTrailingSlash(event.workdir) + event.filename;

        var conn = new FTPS(node.serverConfig.options);
        conn.rmdir(filename).exec(function(err, res) {
            if (!responseErrorHandler(err, res, msg)) {
                msg.workdir = event.workdir;
                msg.payload = {};
                msg.payload.filename = event.filename;
                msg.payload.filepath = filename;
                node.send(msg);
                node.status(statuses.blank);
            }
        });
    };

    this.commands.rmrf = function(event, msg)
    {
        var filename =
        utils.addTrailingSlash(event.workdir) + event.filename;

        var conn = new FTPS(node.serverConfig.options);
        conn.raw('rm -r -f ' + conn._escapeshell(filename));
        conn.exec(function(err, res) {
            if (!responseErrorHandler(err, res, msg)) {
                msg.workdir = event.workdir;
                msg.payload = {};
                msg.payload.filename = event.filename;
                msg.payload.filepath = filename;
                node.send(msg);
                node.status(statuses.blank);
            }
        });
    };

    this.commands.move = function(event, msg)
    {
        var filename =
            utils.addTrailingSlash(event.workdir) + event.filename;
        var targetFilename =
            utils.addTrailingSlash(event.workdir) + event.targetFilename;

        var conn = new FTPS(node.serverConfig.options);
        conn.mv(filename, targetFilename).exec(function(err, res) {
            if (!responseErrorHandler(err, res, msg)) {
                msg.workdir = event.workdir;
                msg.payload = {};
                msg.payload.filename = event.targetFilename;
                msg.payload.filepath = targetFilename;
                node.send(msg);
                node.status(statuses.blank);
            }
        });
    };

    this.commands.raw = function(event, msg)
    {
        var conn = new FTPS(node.serverConfig.options);
        if (Array.isArray(msg.payload)) {
            for (var i = 0, len = msg.payload.length; i < len; i++) {
                conn.raw(msg.payload[i]);
            }
        } else {
            conn.raw(msg.payload);
        }
        conn.exec(function(err, res) {
            if (!responseErrorHandler(err, res, msg)) {
                msg.payload = res.data;
                node.send(msg);
                node.status(statuses.blank);
            }
        });
    };

    if (this.server) {
      //console.log("lftp - this.serverConfig: " + JSON.stringify(this.serverConfig));

      node.on("input", function(msg) {
            try {
                /**
                 * flag status immediately
                 */
                node.status(statuses.active);

                /**
                 * need to ensure all event values can be set via node or msg
                 * to facilitate the per msg operation functionality
                 */
                var event = {};
                event.operation = node.operation || msg.operation || "";
                event.workdir = node.workdir || msg.workdir || "";
                event.filename = node.filename || msg.payload.filename || "";
                event.targetFilename =
                    node.targetFilename || msg.payload.targetFilename || "";
                event.savedir = node.savedir || msg.savedir || "";
                event.localFilename = node.localFilename || msg.localFilename || msg.payload.localFilename || "";

                /**
                 * set this across the board so downstream processing has the
                 * canonical last operation
                 */
                msg.operation = event.operation;

                if (event.operation && node.commands[event.operation]) 
                {
                    node.commands[event.operation](event, msg);
                } 
                else 
                {
                    node.error("invalid operation: " + event.operation, msg);
                    node.status(statuses.error);
                }

            } catch (error) {
                node.error(error, msg);
                node.status(statuses.blank);
            }
      });
    } else {
      node.error("missing server configuration");
      node.status(statuses.blank);
    }
  }

  RED.nodes.registerType("lftp-command", LftpCommandNode);
};
