
# node-red-contrib-lftp

A node-red node that supports FTP(s) and SFTP file transfer. [github] (https://github.com/travisghansen/node-red-contrib-lftp)


# Install

You **must** have the `lftp` binary installed.

```
apt-get install -y lftp
apk add --no-cache lftp
yum install lftp
pacman -S lftp
etc
```

```
npm install --save node-red-contrib-lftp
```

# Documentation
TODO

# Security
Be aware of the security implications of running this node.  Behind the scenes
javascript is executing the `lftp` binary.  The `lftp` binary can execute other
processes on the host system indirectly.  Only run this if you are sure of your
environment and understand the implications.

# Development
 * https://github.com/Atinux/node-ftps
 * http://lftp.yar.ru/lftp-man.html
 * https://nodered.org/docs/creating-nodes/packaging
 * https://nodered.org/docs/creating-nodes/credentials

# TODO
 * make `put` use magical pipes/fifo to prevent writing to host file-system
  * https://www.mail-archive.com/lftp@uniyar.ac.ru/msg02807.html
  * https://stackoverflow.com/questions/33744703/how-to-transfer-data-into-remote-file-over-sftp-without-storing-data-in-a-local
  * https://forums.gentoo.org/viewtopic-t-569241-view-next.html?sid=019bc4d2fc0a7f103f7d5d007f359227
 * support `sftp` using keys
 * ~~support `rmdir`~~
 * ~~support `rmrf`~~
 * support for host operations (ie: upload/download to/from the **host fs** running `node-red`)

# License

See [license] (https://github.com/travisghansen/node-red-contrib-lftp/blob/master/LICENSE) (MIT).
