//go:build !linux

package forward

import (
	"errors"
	"net"
)

// OriginalDst needs netfilter, so the forwarder runs only on Linux.
func OriginalDst(net.Conn) (string, error) {
	return "", errors.New("the forwarder needs Linux (SO_ORIGINAL_DST)")
}
