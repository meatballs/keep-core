package walletcmd

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"os"
	"sort"
	"text/tabwriter"

	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/keep-network/keep-core/pkg/bitcoin"
	"github.com/keep-network/keep-core/pkg/tbtc"
)

type depositEntry struct {
	wallet [20]byte

	depositKey      string
	revealedAtBlock uint64
	isSwept         bool

	fundingTransactionHash        bitcoin.Hash
	fundingTransactionOutputIndex uint32
	amountBtc                     float64
}

// ListDeposits gets deposits from the chain.
func ListDeposits(
	tbtcChain tbtc.Chain,
	walletStr string,
	hideSwept bool,
	sortByAmount bool,
) error {
	deposits, err := getDeposits(tbtcChain, walletStr)
	if err != nil {
		return fmt.Errorf(
			"failed to get deposits: [%w]",
			err,
		)
	}

	if len(deposits) == 0 {
		return fmt.Errorf("no deposits found")
	}

	// Filter
	if hideSwept {
		deposits = removeSwept(deposits)
	}

	// Order
	sort.SliceStable(deposits, func(i, j int) bool {
		return deposits[i].revealedAtBlock > deposits[j].revealedAtBlock
	})

	if sortByAmount {
		sort.SliceStable(deposits, func(i, j int) bool {
			return deposits[i].amountBtc < deposits[j].amountBtc
		})
	}

	// Print
	if err := printTable(deposits); err != nil {
		return fmt.Errorf("failed to print deposits table: %v", err)
	}

	return nil
}

func removeSwept(deposits []depositEntry) []depositEntry {
	result := []depositEntry{}
	for _, deposit := range deposits {
		if deposit.isSwept {
			continue
		}
		result = append(result, deposit)
	}
	return result
}

func getDeposits(tbtcChain tbtc.Chain, walletStr string) ([]depositEntry, error) {
	logger.Infof("reading deposits from chain...")

	filter := &tbtc.DepositRevealedEventFilter{}
	if len(walletStr) > 0 {
		walletPublicKeyHash, err := hexToWalletPublicKeyHash(walletStr)
		if err != nil {
			return []depositEntry{}, fmt.Errorf("failed to extract wallet public key hash: %v", err)
		}

		filter.WalletPublicKeyHash = [][20]byte{walletPublicKeyHash}
	}

	depositRevealedEvent, err := tbtcChain.PastDepositRevealedEvents(filter)
	if err != nil {
		return []depositEntry{}, fmt.Errorf(
			"failed to get past deposit revealed events: [%w]",
			err,
		)
	}

	logger.Infof("found %d DepositRevealed events", len(depositRevealedEvent))

	result := make([]depositEntry, len(depositRevealedEvent))
	for i, event := range depositRevealedEvent {
		logger.Debugf("getting details of deposit %d/%d", i+1, len(depositRevealedEvent))

		depositKey := buildDepositKey(event.FundingTxHash, event.FundingOutputIndex)

		depositRequest, err := tbtcChain.GetDepositRequest(event.FundingTxHash, event.FundingOutputIndex)
		if err != nil {
			return result, fmt.Errorf(
				"failed to get deposit request: [%w]",
				err,
			)
		}

		result[i] = depositEntry{
			wallet:                        event.WalletPublicKeyHash,
			depositKey:                    depositKey,
			revealedAtBlock:               event.BlockNumber,
			isSwept:                       depositRequest.SweptAt.After(depositRequest.RevealedAt),
			fundingTransactionHash:        event.FundingTxHash,
			fundingTransactionOutputIndex: event.FundingOutputIndex,
			amountBtc:                     convertSatToBtc(float64(depositRequest.Amount)),
		}
	}

	return result, nil
}

func printTable(deposits []depositEntry) error {
	w := tabwriter.NewWriter(os.Stdout, 2, 4, 1, ' ', tabwriter.AlignRight)
	fmt.Fprintf(w, "index\twallet\tvalue (BTC)\tdeposit key\tfunding transaction\tswept\t\n")

	for i, deposit := range deposits {
		fmt.Fprintf(w, "%d\t%s\t%.5f\t%s\t%s\t%v\t\n",
			i,
			"0x"+hex.EncodeToString(deposit.wallet[:]),
			deposit.amountBtc,
			deposit.depositKey,
			fmt.Sprintf(
				"%s:%d",
				deposit.fundingTransactionHash.Hex(bitcoin.ReversedByteOrder),
				deposit.fundingTransactionOutputIndex,
			),
			deposit.isSwept,
		)
	}
	w.Flush()

	return nil
}

func hexToWalletPublicKeyHash(str string) ([20]byte, error) {
	walletHex, err := hexutil.Decode(str)
	if err != nil {
		return [20]byte{}, fmt.Errorf("failed to parse arguments: %w", err)
	}

	var walletPublicKeyHash [20]byte
	copy(walletPublicKeyHash[:], walletHex)

	return walletPublicKeyHash, nil
}

func buildDepositKey(
	fundingTxHash bitcoin.Hash,
	fundingOutputIndex uint32,
) string {
	fundingOutputIndexBytes := make([]byte, 4)
	binary.BigEndian.PutUint32(fundingOutputIndexBytes, fundingOutputIndex)

	depositKey := crypto.Keccak256Hash(
		append(fundingTxHash[:], fundingOutputIndexBytes...),
	)

	return depositKey.Hex()
}

func convertSatToBtc(sats float64) float64 {
	return sats / float64(100000000)
}
