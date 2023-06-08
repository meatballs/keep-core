package tbtc

import (
	"crypto/ecdsa"
	"fmt"
	"github.com/keep-network/keep-core/pkg/bitcoin"
	"github.com/keep-network/keep-core/pkg/chain"
	"time"
)

// RedemptionTransactionShape is an enum describing the shape of
// a Bitcoin redemption transaction.
type RedemptionTransactionShape uint8

const (
	// ChangeFirstRedemption is a shape where the change output is the first one
	// in the transaction output vector. This shape makes the change's position
	// fixed and leverages some SPV proof cost optimizations made in the Bridge
	// implementation.
	ChangeFirstRedemption RedemptionTransactionShape = iota
	// ChangeLastRedemption is a shape where the change output is the last one
	// in the transaction output vector.
	ChangeLastRedemption
)

// RedemptionRequest represents a tBTC redemption request.
type RedemptionRequest struct {
	// Redeemer is the redeemer's address on the host chain.
	Redeemer chain.Address
	// RedeemerOutputScript is the output script the redeemed Bitcoin funds are
	// locked to. This field is not prepended with the byte-length of the script.
	RedeemerOutputScript []byte
	// RequestedAmount is the TBTC amount (in satoshi) requested for redemption.
	RequestedAmount uint64
	// TreasuryFee is the treasury TBTC fee (in satoshi) at the moment of
	// request creation.
	TreasuryFee uint64
	// TxMaxFee is the maximum value of the per-redemption BTC tx fee (in satoshi)
	// that can be incurred by this request, determined at the moment of
	// request creation.
	TxMaxFee uint64
	// RequestedAt is the time the request was created at.
	RequestedAt time.Time
}

// assembleRedemptionTransaction constructs an unsigned redemption Bitcoin
// transaction.
//
// Regarding input arguments, the walletMainUtxo parameter is mandatory and
// must be set accordingly. The requests slice must contain at least one element.
// The fee argument is not validated in any way so must be chosen with respect
// to the system limitations.
//
// The resulting bitcoin.TransactionBuilder instance holds all the data
// necessary to sign the transaction and obtain a bitcoin.Transaction instance
// ready to be spread across the Bitcoin network.
func assembleRedemptionTransaction(
	bitcoinChain bitcoin.Chain,
	walletPublicKey *ecdsa.PublicKey,
	walletMainUtxo *bitcoin.UnspentTransactionOutput,
	requests []*RedemptionRequest,
	fee int64,
	shape ...RedemptionTransactionShape,
) (*bitcoin.TransactionBuilder, error) {
	resolvedShape := ChangeFirstRedemption
	if len(shape) == 1 {
		resolvedShape = shape[0]
	}

	if walletMainUtxo == nil {
		return nil, fmt.Errorf("wallet main UTXO is required")
	}

	redemptionsCount := int64(len(requests))

	if redemptionsCount < 1 {
		return nil, fmt.Errorf("at least one redemption request is required")
	}

	builder := bitcoin.NewTransactionBuilder(bitcoinChain)

	err := builder.AddPublicKeyHashInput(walletMainUtxo)
	if err != nil {
		return nil, fmt.Errorf(
			"cannot add input pointing to wallet main UTXO: [%v]",
			err,
		)
	}

	feePerRedemptionRemainder := fee % redemptionsCount
	feePerRedemption := (fee - feePerRedemptionRemainder) / redemptionsCount

	// Helper variable that will hold the summarized value of all redemption
	// outputs. The change value will not be counted in here.
	totalRedemptionOutputsValue := int64(0)

	// List that will hold all transaction outputs, i.e. redemption outputs
	// and the possible change output.
	outputs := make([]*bitcoin.TransactionOutput, 0)

	// Create redemption outputs based on the provided redemption requests but
	// do not add them to the transaction builder yet. The builder cannot be
	// filled right now due to the change output that will be constructed in the
	// next step and whose position in the transaction output vector depends on
	// the requested RedemptionTransactionShape.
	for i, request := range requests {
		// The redeemable amount for a redemption request is the difference
		// between the requested amount and treasury fee computed upon
		// request creation.
		redeemableAmount := int64(request.RequestedAmount - request.TreasuryFee)
		// The actual value of the redemption output is the difference between
		// the request's redeemable amount and fee per redemption.
		redemptionOutputValue := redeemableAmount - feePerRedemption
		// Make the last redemption incur the fee remainder.
		if i == len(requests)-1 {
			redemptionOutputValue -= feePerRedemptionRemainder
		}

		totalRedemptionOutputsValue += redemptionOutputValue

		redemptionOutput := &bitcoin.TransactionOutput{
			Value:           redemptionOutputValue,
			PublicKeyScript: request.RedeemerOutputScript,
		}

		outputs = append(outputs, redemptionOutput)
	}

	// We know that the total fee of a Bitcoin transaction is the difference
	// between the sum of inputs and the sum of outputs. In the case of a
	// redemption transaction, that translates to the following formula:
	// fee = main_utxo_input_value - (redemption_outputs_value + change_value)
	// That means we can calculate the change's value using:
	// change_value = main_utxo_input_value - redemption_outputs_value - fee
	changeOutputValue := builder.TotalInputsValue() -
		totalRedemptionOutputsValue -
		fee

	// If we can have a non-zero change, construct it.
	if changeOutputValue > 0 {
		changeOutputScript, err := bitcoin.PayToWitnessPublicKeyHash(
			bitcoin.PublicKeyHash(walletPublicKey),
		)
		if err != nil {
			return nil, fmt.Errorf(
				"cannot compute change output script: [%v]",
				err,
			)
		}

		changeOutput := &bitcoin.TransactionOutput{
			Value:           changeOutputValue,
			PublicKeyScript: changeOutputScript,
		}

		switch resolvedShape {
		case ChangeFirstRedemption:
			outputs = append([]*bitcoin.TransactionOutput{changeOutput}, outputs...)
		case ChangeLastRedemption:
			outputs = append(outputs, changeOutput)
		default:
			panic("unknown redemption transaction shape")
		}
	}

	// Finally, fill the builder with outputs constructed so far.
	for _, output := range outputs {
		builder.AddOutput(output)
	}

	return builder, nil
}
