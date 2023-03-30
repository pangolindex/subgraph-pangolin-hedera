/* Generated from mustache template for network: {{network}} */
/* eslint-disable prefer-const */
import {BigDecimal} from '@graphprotocol/graph-ts'
import {Pair, Token, Bundle, PairLookup} from '../../generated/schema'
import {ZERO_BD, ADDRESS_ZERO, ONE_BD, WHBAR_ADDRESS, TWO_BD} from './helpers'

let AVERAGE_WHBAR_PRICE_PRE_STABLES = BigDecimal.fromString('1')

export function getAVAXPriceInUSD(): BigDecimal {

    let pair: Pair | null

    // Iterated 'StablePairs' from config
    {{#StablePairs}}
    pair = Pair.load("{{.}}")
    if (pair != null) {
        return pair.token0 == WHBAR_ADDRESS ? pair.token1Price : pair.token0Price
    }
    {{/StablePairs}}

    return AVERAGE_WHBAR_PRICE_PRE_STABLES
}

// token where amounts should contribute to tracked volume and liquidity
let WHITELIST: string[] = [
    {{#WhitelistPricing}}
    "{{.}}",
    {{/WhitelistPricing}}
]

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_ETH = BigDecimal.fromString('1')

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token): BigDecimal {
    if (token.id == WHBAR_ADDRESS) {
        return ONE_BD
    }
    // loop through whitelist and check if paired with any
    for (let i = 0; i < WHITELIST.length; ++i) {
        let pairLookup = PairLookup.load(token.id.concat('-').concat(WHITELIST[i]))
        let pairAddress = pairLookup == null ? ADDRESS_ZERO : pairLookup.pairAddress.toHexString()

        if (pairAddress != ADDRESS_ZERO) {
            let pair = Pair.load(pairAddress)!
            if (pair.token0 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
                let token1 = Token.load(pair.token1)!
                return pair.token1Price.times(token1.derivedETH as BigDecimal) // return token1 per our token * Eth per token 1
            }
            if (pair.token1 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
                let token0 = Token.load(pair.token0)!
                return pair.token0Price.times(token0.derivedETH as BigDecimal) // return token0 per our token * ETH per token 0
            }
        }
    }
    return ZERO_BD // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
    tokenAmount0: BigDecimal,
    token0: Token,
    tokenAmount1: BigDecimal,
    token1: Token
): BigDecimal {
    let price0 = token0.derivedUSD as BigDecimal
    let price1 = token1.derivedUSD as BigDecimal

    // both are whitelist tokens, take average of both amounts
    if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
        return tokenAmount0
            .times(price0)
            .plus(tokenAmount1.times(price1))
            .div(TWO_BD)
    }

    // take full value of the whitelisted token amount
    if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
        return tokenAmount0.times(price0)
    }

    // take full value of the whitelisted token amount
    if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
        return tokenAmount1.times(price1)
    }

    // neither token is on white list, tracked volume is 0
    return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
    tokenAmount0: BigDecimal,
    token0: Token,
    tokenAmount1: BigDecimal,
    token1: Token
): BigDecimal {
    let bundle = Bundle.load('1')!
    let price0 = token0.derivedETH.times(bundle.ethPrice)
    let price1 = token1.derivedETH.times(bundle.ethPrice)

    // both are whitelist tokens, take average of both amounts
    if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
        return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
    }

    // take double value of the whitelisted token amount
    if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
        return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
    }

    // take double value of the whitelisted token amount
    if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
        return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
    }

    // neither token is on white list, tracked volume is 0
    return ZERO_BD
}
