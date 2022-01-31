import {
  FETCH_THRESHOLD_AUTH_DATA_START,
  FETCH_THRESHOLD_AUTH_DATA_SUCCESS,
  FETCH_THRESHOLD_AUTH_DATA_FAILURE,
  THRESHOLD_AUTHORIZED,
  THRESHOLD_STAKED_TO_T,
} from "../actions"
import { findIndexAndObject, compareEthAddresses } from "../utils/array.utils"
import { AUTH_CONTRACTS_LABEL } from "../constants/constants"

const initialState = {
  authData: [],
  isFetching: false,
  error: null,
}

const thresholdAuthorizationReducer = (state = initialState, action) => {
  switch (action.type) {
    case FETCH_THRESHOLD_AUTH_DATA_START:
      return {
        ...state,
        isFetching: true,
      }
    case FETCH_THRESHOLD_AUTH_DATA_SUCCESS:
      return {
        ...state,
        isFetching: false,
        authData: action.payload,
      }
    case FETCH_THRESHOLD_AUTH_DATA_FAILURE:
      return {
        ...state,
        isFetching: false,
        error: action.payload.error,
      }
    case THRESHOLD_AUTHORIZED:
      return {
        ...state,
        authData: authorizeThresholdContract([...state.authData], {
          ...action.payload,
        }),
      }
    case THRESHOLD_STAKED_TO_T:
      return {
        ...state,
        authData: updateThresholdAuthData([...state.authData], {
          ...action.payload,
        }),
      }
    default:
      return state
  }
}

const authorizeThresholdContract = (authData, { operatorAddress }) => {
  const { indexInArray: operatorIndexInArray, obj: obsoleteOperator } =
    findIndexAndObject(
      "operatorAddress",
      operatorAddress,
      authData,
      compareEthAddresses
    )

  if (operatorIndexInArray === null) {
    return authData
  }

  const { indexInArray: contractIndexInArray, obj: obsoleteContract } =
    findIndexAndObject(
      "contractName",
      AUTH_CONTRACTS_LABEL.THRESHOLD_TOKEN_STAKING,
      obsoleteOperator.contracts
    )

  const updatedContracts = [...obsoleteOperator.contracts]
  updatedContracts[contractIndexInArray] = {
    ...obsoleteContract,
    isAuthorized: true,
  }
  const updatedOperators = [...authData]
  updatedOperators[operatorIndexInArray] = {
    ...obsoleteOperator,
    contracts: updatedContracts,
  }

  return updatedOperators
}

const updateThresholdAuthData = (authData, { operatorAddress }) => {
  const { indexInArray: operatorIndexInArray, obj: obsoleteOperator } =
    findIndexAndObject(
      "operatorAddress",
      operatorAddress,
      authData,
      compareEthAddresses
    )
  if (operatorIndexInArray === null) {
    return authData
  }

  const updatedOperators = [...authData]
  updatedOperators[operatorIndexInArray] = {
    ...obsoleteOperator,
    isStakedToT: true,
  }

  return updatedOperators
}

export default thresholdAuthorizationReducer
