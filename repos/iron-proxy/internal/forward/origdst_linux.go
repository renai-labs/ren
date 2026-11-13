//go:build linux

package forward

import (
	"errors"
	"net"
	"strconv"
	"syscall"
)

// soOriginalDst is SO_ORIGINAL_DST from linux/netfilter_ipv4.h.
const soOriginalDst = 80

// OriginalDst says where a connection that nf_tables redirected was going.
// It reads the IPv4 address that netfilter kept for the connection.
func OriginalDst(conn net.Conn) (string, error) {
	tcp, ok := conn.(*net.TCPConn)
	if !ok {
		return "", errors.New("not a TCP connection")
	}
	raw, err := tcp.SyscallConn()
	if err != nil {
		return "", err
	}
	var addr *syscall.IPv6Mreq
	var sockErr error
	if err := raw.Control(func(fd uintptr) {
		// The kernel writes a sockaddr_in (16 bytes); IPv6Mreq is a 20-byte
		// buffer that holds it: port at 2..3, address at 4..7.
		addr, sockErr = syscall.GetsockoptIPv6Mreq(int(fd), syscall.IPPROTO_IP, soOriginalDst)
	}); err != nil {
		return "", err
	}
	if sockErr != nil {
		return "", sockErr
	}
	b := addr.Multiaddr
	ip := net.IPv4(b[4], b[5], b[6], b[7])
	port := int(b[2])<<8 | int(b[3])
	return net.JoinHostPort(ip.String(), strconv.Itoa(port)), nil
}
