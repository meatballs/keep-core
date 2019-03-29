package gjkr

import (
	"fmt"
	"math/big"
	"reflect"
	"testing"

	"github.com/keep-network/keep-core/pkg/beacon/relay/group"
)

func TestNewMemberWithInvalidID(t *testing.T) {
	expectedError := fmt.Errorf("could not create a new member [member index must be >= 1]")

	_, err := NewMember(group.MemberIndex(0), nil, 13, nil)

	if !reflect.DeepEqual(err, expectedError) {
		t.Fatalf("\nexpected: %v\nactual:   %v\n", expectedError, err)
	}
}

func TestAddToGroupWithInvalidID(t *testing.T) {
	expectedError := fmt.Errorf("could not add the member ID to the group [member index must be >= 1]")

	newMember, err := NewMember(group.MemberIndex(1), nil, 13, big.NewInt(14))
	if err != nil {
		t.Error(err)
	}

	err = newMember.AddToGroup(group.MemberIndex(0))

	if !reflect.DeepEqual(err, expectedError) {
		t.Fatalf("\nexpected: %v\nactual:   %v\n", expectedError, err)
	}
}

func TestMemberIDValidate(t *testing.T) {
	var tests = map[string]struct {
		id            group.MemberIndex
		expectedError error
	}{
		"id = 0": {
			id:            group.MemberIndex(0),
			expectedError: fmt.Errorf("member index must be >= 1"),
		},
		"id = 1": {
			id:            1,
			expectedError: nil,
		},
	}
	for _, test := range tests {
		err := test.id.Validate()

		if !reflect.DeepEqual(err, test.expectedError) {
			t.Fatalf("\nexpected: %v\nactual:   %v\n", test.expectedError, err)
		}
	}
}
