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
      //username: n.username || "", // Optional. Use empty username for anonymous access.
      //password: n.password || "", // Required if username is not empty, except when requiresPassword: false
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
      autoConfirm: true, // Optional, is used to auto confirm ssl questions on sftp or fish protocols, defaults to false
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

    //console.log(this.options);
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

    if (this.server) {
      //console.log("lftp - this.serverConfig: " + JSON.stringify(this.serverConfig));

      node.on("input", function(msg) {
        try {
          node.workdir = node.workdir || msg.workdir || "";
          node.filename = node.filename || msg.payload.filename || "";
          node.targetFilename =
            node.targetFilename || msg.payload.targetFilename || "";
          node.savedir = node.savedir || msg.savedir || "";
          node.localFilename = node.localFilename || msg.localFilename || "";

          /*server options*/
          node.serverConfig.options.host =
            msg.host || node.serverConfig.options.host;
          node.serverConfig.options.port =
            msg.port || node.serverConfig.options.port;
          node.serverConfig.options.username =
            msg.username || node.serverConfig.options.username;
          node.serverConfig.options.password =
            msg.password || node.serverConfig.options.password;

          //console.log("lftp - performing operation: " + node.operation);

          switch (node.operation) {
            case "list":
              var conn = new FTPS(node.serverConfig.options);
              conn
                .cd(node.workdir)
                .ls()
                .exec(function(err, res) {
                  //console.log(res);
                  if (err) {
                    node.error(err, msg);
                  } else if (res.error) {
                    node.error(res.error, msg);
                  } else {
                    Parser.parseEntries(res.data, function(err, data) {
                      msg.workdir = node.workdir;
                      msg.payload = {};
                      msg.payload = data;
                      node.send(msg);
                    });
                  }
                });
              break;
            case "get":
              // set filename
              var filename =
                utils.addTrailingSlash(node.workdir) + node.filename;

              var conn = new FTPS(node.serverConfig.options);
              conn.cat(filename).exec(function(err, res) {
                //console.log(res);
                if (err) {
                  node.error(err, msg);
                } else if (res.error) {
                  node.error(res.error, msg);
                } else {
                  node.status({});
                  msg.workdir = node.workdir;
                  msg.payload = {};
                  msg.payload.filedata = res.data;
                  msg.payload.filename = node.filename;
                  msg.payload.filepath = filename;
                  node.send(msg);
                }
              });
              break;
            case "put":
              if (!node.filename.length > 0) {
                var d = new Date();
                var guid = d.getTime().toString();

                if (node.fileExtension == "") {
                  node.fileExtension = ".txt";
                }

                node.filename = guid + node.fileExtension;
              }

              var filename =
                utils.addTrailingSlash(node.workdir) + node.filename;
              var filedata =
                msg.payload.filedata || JSON.stringify(msg.payload);

              /**
               * with lftp we cannot stream data directly so it must be
               * temporarily written to disk, put, then deleted locally
               */
              tmp.file(function(err, path, fd, cleanupCallback) {
                if (err) throw err;

                fs.writeFile(path, filedata, function(err) {
                  if (err) {
                    cleanupCallback();
                    throw err;
                  }

                  var conn = new FTPS(node.serverConfig.options);
                  conn.put(path, filename).exec(function(err, res) {
                    //console.log(res);
                    cleanupCallback();
                    if (err) {
                      node.error(err, msg);
                    } else if (res.error) {
                      node.error(res.error, msg);
                    } else {
                      node.status({});
                      msg.workdir = node.workdir;
                      msg.payload = {};
                      msg.payload.filename = node.filename;
                      msg.payload.filepath = filename;
                      node.send(msg);
                    }
                  });
                });
              });
              break;
            case "delete":
              // set filename
              var filename =
                utils.addTrailingSlash(node.workdir) + node.filename;

              var conn = new FTPS(node.serverConfig.options);
              conn.rm(filename).exec(function(err, res) {
                //console.log(res);
                if (err) {
                  node.error(err, msg);
                } else if (res.error) {
                  node.error(res.error, msg);
                } else {
                  node.status({});
                  msg.workdir = node.workdir;
                  msg.payload = {};
                  msg.payload.filename = node.filename;
                  msg.payload.filepath = filename;
                  node.send(msg);
                }
              });
              break;
            case "move":
              // move filename
              var filename =
                utils.addTrailingSlash(node.workdir) + node.filename;
              var targetFilename =
                utils.addTrailingSlash(node.workdir) + node.targetFilename;

              var conn = new FTPS(node.serverConfig.options);
              conn.mv(filename, targetFilename).exec(function(err, res) {
                //console.log(res);
                if (err) {
                  node.error(err, msg);
                } else if (res.error) {
                  node.error(res.error, msg);
                } else {
                  node.status({});
                  msg.workdir = node.workdir;
                  msg.payload = {};
                  msg.payload.filename = node.targetFilename;
                  msg.payload.filepath = targetFilename;
                  node.send(msg);
                }
              });
              break;
            case "raw":
              var conn = new FTPS(node.serverConfig.options);
              if (Array.isArray(msg.payload)) {
                for (var i = 0, len = msg.payload.length; i < len; i++) {
                  conn.raw(msg.payload[i]);
                }
              } else {
                conn.raw(msg.payload);
              }
              conn.exec(function(err, res) {
                //console.log(res);
                if (err) {
                  node.error(err, msg);
                } else if (res.error) {
                  node.error(res.error, msg);
                } else {
                  node.status({});
                  msg.payload = res.data;
                  node.send(msg);
                }
              });
              break;
          }
        } catch (error) {
          node.error(error, msg);
        }
      });
    } else {
      node.error("missing server configuration");
    }
  }
  RED.nodes.registerType("lftp-command", LftpCommandNode);
};
