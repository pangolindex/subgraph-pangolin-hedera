/* eslint-disable prefer-const */
import {BigInt, BigDecimal, Address, log} from "@graphprotocol/graph-ts"
import {ERC20} from "../../generated/Factory/ERC20"
import {ERC20SymbolBytes} from "../../generated/Factory/ERC20SymbolBytes"
import {ERC20NameBytes} from "../../generated/Factory/ERC20NameBytes"
import {Pair} from "../../generated/schema"
import {RewarderViaMultiplierForPangoChef} from "../../generated/PangoChef/RewarderViaMultiplierForPangoChef";

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'
export const ROUTER_ADDRESS = '0x0000000000000000000000000000000002ef16f2'
export const WHBAR_ADDRESS = '0x0000000000000000000000000000000002dfa5b2'
export const PNG_ADDRESS = '0x0000000000000000000000000000000002ef16ec'

export const WHBAR_USDC_PAIR = '0x58f2368857e345f21ca96c246eeac73fa52b3f70'

export let ZERO_BI = BigInt.fromI32(0)
export let ONE_BI = BigInt.fromI32(1)
export let ZERO_BD = BigDecimal.fromString("0")
export let ONE_BD = BigDecimal.fromString("1")
export let TWO_BD = BigDecimal.fromString("2")
export let TEN_BD = BigDecimal.fromString("10")
export let PGL_DECIMALS = BigInt.fromI32(0)
export let BI_MINIMUM_LIQUIDITY = BigInt.fromI32(1000)

export let PANGO_CHEF_INITIAL_WEIGHT = BigInt.fromI32(1000)
export let PANGO_CHEF_INITIAL_PERIOD_DURATION = BigInt.fromI32(86400)

export function convertPairAddress(incoming: string): Address {
    if (incoming.toLowerCase() == '0x0000000000000000000000000000000002ef16f4') { // PBAR-WHBAR
        return Address.fromString('0x69ab45b1a359fd991889c358767b96b66bf11794')
    } else if (incoming.toLowerCase() == '0x0000000000000000000000000000000002ef360a') { // USDC-WHBAR
        return Address.fromString('0x58f2368857e345f21ca96c246eeac73fa52b3f70')
    // } else if (incoming.toLowerCase() == '0x0000000000000000000000000000000002eceb16') { // USDC-PBAR
    //     return Address.fromString('0x1a09bfcb756c88e17c4c26dc3eecdc7ede0ce827')
    } else {
        log.warning('Unconverted pair address {}', [incoming])
        return Address.fromString(incoming)
    }
}

export function loadPair(addressString: string): Pair | null {
    let adjustedAddress = convertPairAddress(addressString)
    return Pair.load(adjustedAddress.toHexString())
}

export function exponentToBigDecimal(decimals: BigInt): BigDecimal {
    let bd = ONE_BD
    for (let i = ZERO_BI; i.lt(decimals as BigInt); i = i.plus(ONE_BI)) {
        bd = bd.times(TEN_BD)
    }
    return bd
}

export function convertTokenToDecimal(
    tokenAmount: BigInt,
    exchangeDecimals: BigInt
): BigDecimal {
    if (exchangeDecimals == ZERO_BI) {
        return tokenAmount.toBigDecimal()
    }
    return tokenAmount.toBigDecimal().div(exponentToBigDecimal(exchangeDecimals))
}

export function isNullEthValue(value: string): boolean {
    return (
        value ==
        "0x0000000000000000000000000000000000000000000000000000000000000001"
    )
}

export function _fetchTokenSymbol(tokenAddress: Address): string {
    // hard coded overrides
    // ...

    let contract = ERC20.bind(tokenAddress)
    let contractSymbolBytes = ERC20SymbolBytes.bind(tokenAddress)

    // try types string and bytes32 for symbol
    let symbolValue = "unknown"
    let symbolResult = contract.try_symbol()
    if (symbolResult.reverted) {
        let symbolResultBytes = contractSymbolBytes.try_symbol()
        if (!symbolResultBytes.reverted) {
            // for broken pairs that have no symbol function exposed
            if (!isNullEthValue(symbolResultBytes.value.toHexString())) {
                symbolValue = symbolResultBytes.value.toString()
            }
        }
    } else {
        symbolValue = symbolResult.value
    }

    return symbolValue
}

export function _fetchTokenName(tokenAddress: Address): string {
    // hard coded overrides
    // ...

    let contract = ERC20.bind(tokenAddress)
    let contractNameBytes = ERC20NameBytes.bind(tokenAddress)

    // try types string and bytes32 for name
    let nameValue = "unknown"
    let nameResult = contract.try_name()
    if (nameResult.reverted) {
        let nameResultBytes = contractNameBytes.try_name()
        if (!nameResultBytes.reverted) {
            // for broken exchanges that have no name function exposed
            if (!isNullEthValue(nameResultBytes.value.toHexString())) {
                nameValue = nameResultBytes.value.toString()
            }
        }
    } else {
        nameValue = nameResult.value
    }

    return nameValue
}

export function _fetchTokenDecimals(tokenAddress: Address): BigInt | null {
    // hardcode overrides
    // ...

    let contract = ERC20.bind(tokenAddress)
    // try types uint8 for decimals
    let decimalResult = contract.try_decimals()
    if (decimalResult.reverted) {
        return null
    } else {
        return BigInt.fromI32(decimalResult.value)
    }
}


export function _fetchRewardTokens(rewarderAddress: Address): Array<Address> {
    let contract = RewarderViaMultiplierForPangoChef.bind(rewarderAddress)
    let totalRewardTokenValue = [] as Array<Address>
    let totalRewardTokenResult = contract.try_getRewardTokens()

    if (!totalRewardTokenResult.reverted) {
        totalRewardTokenValue = totalRewardTokenResult.value
    }

    return totalRewardTokenValue
}

export function _fetchRewardMultipliers(
    rewarderAddress: Address
): Array<BigInt> {
    let contract = RewarderViaMultiplierForPangoChef.bind(rewarderAddress)
    let totalRewardMultiplierValue = [] as Array<BigInt>
    let totalRewardMultiplierResult = contract.try_getRewardMultipliers()
    if (!totalRewardMultiplierResult.reverted) {
        totalRewardMultiplierValue = totalRewardMultiplierResult.value
    }

    return totalRewardMultiplierValue as Array<BigInt>
}