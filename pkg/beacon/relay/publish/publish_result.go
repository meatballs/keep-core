package publish

import (
	"fmt"
	"math/big"

	"github.com/keep-network/keep-core/pkg/beacon/relay/event"
	"github.com/keep-network/keep-core/pkg/beacon/relay/gjkr"
	"github.com/keep-network/keep-core/pkg/chain"
)

// Publisher is a member submitting distributed key generation result to a
// blockchain.
type Publisher struct {
	ID gjkr.MemberID
	// ID of distributed key generation execution.
	RequestID *big.Int
	// Handle to interact with a blockchain.
	chainHandle chain.Handle
	// Sequential number of the current member in the publishing group.
	// The value is used to determine eligible publishing member. Relates to DKG
	// Phase 13.
	publishingIndex int
	// Predefined step for each publishing window. The value is used to determine
	// eligible publishing member. Relates to DKG Phase 13.
	blockStep int
}

// PublishResult sends a result containing i.a. group public key to the blockchain.
// It checks if the result has already been published to the blockchain. If not
// it determines if the current member is eligable to result submission. If allowed
// it submits the results to the blockchain. The function returns result published
// to the blockchain containing ID of the member who published it.
//
// See Phase 13 of the protocol specification.
func (pm *Publisher) PublishResult(resultToPublish *gjkr.Result) (*event.PublishedResult, error) {
	chainRelay := pm.chainHandle.ThresholdRelay()

	onPublishedResultChan := make(chan *event.PublishedResult)
	chainRelay.OnResultPublished(func(publishedResult *event.PublishedResult) {
		onPublishedResultChan <- publishedResult
	})

	// Check if the result has already been published to the chain.
	if publishedResult := chainRelay.IsResultPublished(resultToPublish); publishedResult != nil {
		return publishedResult, nil
	}

	blockCounter, err := pm.chainHandle.BlockCounter()
	if err != nil {
		return nil, fmt.Errorf("block counter failure [%v]", err)
	}

	// Waits until the current member is eligible to submit a result to the
	// blockchain.
	eligibleToSubmitWaiter, err := blockCounter.BlockWaiter(
		pm.publishingIndex * pm.blockStep,
	)
	if err != nil {
		return nil, fmt.Errorf("block waiter failure [%v]", err)
	}

	for {
		select {
		case <-eligibleToSubmitWaiter:
			publishedResultChan := make(chan *event.PublishedResult)
			errors := make(chan error)

			chainRelay.SubmitResult(pm.ID, resultToPublish).
				OnComplete(func(publishedResult *event.PublishedResult, err error) {
					publishedResultChan <- publishedResult
					errors <- err
				})
			return <-publishedResultChan, <-errors

		case newResult := <-onPublishedResultChan:
			// Check if published result matches a result the current member
			// wants to publish.
			if resultToPublish.Equals(newResult.Result) {
				return newResult, nil
			}
		}
	}
}
