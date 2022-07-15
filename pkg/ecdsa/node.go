package ecdsa

import (
	"github.com/keep-network/keep-common/pkg/persistence"
	"github.com/keep-network/keep-core/pkg/net"
	"math/big"
)

// Node represents the current state of an ECDSA node.
type Node struct {
	chain       Chain
	netProvider net.Provider
}

func newNode(
	chain Chain,
	netProvider net.Provider,
	persistence persistence.Handle,
) *Node {
	return &Node{
		chain:       chain,
		netProvider: netProvider,
	}
}

// joinDKGIfEligible takes a seed value and undergoes the process of the
// distributed key generation if this node's operator proves to be eligible for
// the group generated by that seed. This is an interactive on-chain process,
// and joinDKGIfEligible can block for an extended period of time while it
// completes the on-chain operation.
func (n *Node) joinDKGIfEligible(seed *big.Int, startBlockNumber uint64) {
	// TODO: Implementation.
}

// RequestWalletSignature asks the given wallet to sign the given data.
func (n *Node) RequestWalletSignature(walletID WalletID, data []byte) []byte {
	// TODO: Implementation. At the moment, this function is here to present
	//       the idea for ECDSA <-> TBTC integration.
	return nil
}
