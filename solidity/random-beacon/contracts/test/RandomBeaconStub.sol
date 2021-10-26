pragma solidity ^0.8.6;

import "../RandomBeacon.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract RandomBeaconStub is RandomBeacon {
    constructor(ISortitionPool _sortitionPool, IERC20 _tToken)
        RandomBeacon(_sortitionPool, _tToken)
    {}

    function getDkgData() external view returns (DKG.Data memory) {
        return dkg;
    }
}
