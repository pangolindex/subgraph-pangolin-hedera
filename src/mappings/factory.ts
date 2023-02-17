/* eslint-disable prefer-const */
import {log} from '@graphprotocol/graph-ts'
import {PangolinFactory, Pair, PairLookup, Token, Bundle} from '../../generated/schema'
import {PairCreated} from '../../generated/Factory/Factory'
import {Pair as PairTemplate} from '../../generated/templates'
import {
    ZERO_BD,
    ZERO_BI,
    _fetchTokenSymbol,
    _fetchTokenName,
    _fetchTokenDecimals
} from './helpers'

export function handleNewPair(event: PairCreated): void {
    // load factory (create if first exchange)
    let factory = PangolinFactory.load('1')
    if (factory === null) {
        factory = new PangolinFactory('1')
        factory.pairCount = 0
        factory.totalVolumeETH = ZERO_BD
        factory.totalLiquidityETH = ZERO_BD
        factory.totalVolumeUSD = ZERO_BD
        factory.untrackedVolumeUSD = ZERO_BD
        factory.totalLiquidityUSD = ZERO_BD
        factory.txCount = ZERO_BI

        // create new bundle
        let bundle = new Bundle('1')
        bundle.ethPrice = ZERO_BD
        bundle.save()
    }
    factory.pairCount = factory.pairCount + 1
    factory.save()

    // fetch info if null
    let token0 = Token.load(event.params.token0.toHexString())
    if (token0 === null) {
        token0 = new Token(event.params.token0.toHexString())
        token0.symbol = _fetchTokenSymbol(event.params.token0)
        token0.name = _fetchTokenName(event.params.token0)
        let decimals = _fetchTokenDecimals(event.params.token0)
        // bail if we couldn't figure out the decimals
        if (decimals === null) {
            log.debug('null decimals for token0', [])
            return
        }

        token0.decimals = decimals
        token0.derivedETH = ZERO_BD
        token0.derivedUSD = ZERO_BD
        token0.tradeVolume = ZERO_BD
        token0.tradeVolumeUSD = ZERO_BD
        token0.untrackedVolumeUSD = ZERO_BD
        token0.totalLiquidity = ZERO_BD
        // token0.allPairs = []
        token0.txCount = ZERO_BI
    }

    // fetch info if null
    let token1 = Token.load(event.params.token1.toHexString())
    if (token1 === null) {
        token1 = new Token(event.params.token1.toHexString())
        token1.symbol = _fetchTokenSymbol(event.params.token1)
        token1.name = _fetchTokenName(event.params.token1)
        let decimals = _fetchTokenDecimals(event.params.token1)

        // bail if we couldn't figure out the decimals
        if (decimals === null) {
            log.debug('null decimals for token1', [])
            return
        }
        token1.decimals = decimals
        token1.derivedETH = ZERO_BD
        token1.derivedUSD = ZERO_BD
        token1.tradeVolume = ZERO_BD
        token1.tradeVolumeUSD = ZERO_BD
        token1.untrackedVolumeUSD = ZERO_BD
        token1.totalLiquidity = ZERO_BD
        // token1.allPairs = []
        token1.txCount = ZERO_BI
    }

    let pair = new Pair(event.params.pair.toHexString()) as Pair
    pair.token0 = token0.id
    pair.token1 = token1.id
    pair.createdAtTimestamp = event.block.timestamp
    pair.createdAtBlockNumber = event.block.number
    pair.txCount = ZERO_BI
    pair.reserve0 = ZERO_BD
    pair.reserve1 = ZERO_BD
    pair.trackedReserveETH = ZERO_BD
    pair.reserveETH = ZERO_BD
    pair.reserveUSD = ZERO_BD
    pair.totalSupply = ZERO_BI
    pair.volumeToken0 = ZERO_BD
    pair.volumeToken1 = ZERO_BD
    pair.volumeUSD = ZERO_BD
    pair.untrackedVolumeUSD = ZERO_BD
    pair.token0Price = ZERO_BD
    pair.token1Price = ZERO_BD
    pair.save()

    // create pair lookup and reverse lookup
    let pairLookupIdAB = event.params.token0.toHexString().concat('-').concat(event.params.token1.toHexString())
    let pairLookupAB = new PairLookup(pairLookupIdAB)
    pairLookupAB.pairAddress = event.params.pair
    pairLookupAB.save()
    let pairLookupIdBA = event.params.token1.toHexString().concat('-').concat(event.params.token0.toHexString())
    let pairLookupBA = new PairLookup(pairLookupIdBA)
    pairLookupBA.pairAddress = event.params.pair
    pairLookupBA.save()

    // create the tracked contract based on the template
    PairTemplate.create(event.params.pair)

    // save updated values
    token0.save()
    token1.save()
    pair.save()
    factory.save()
}
