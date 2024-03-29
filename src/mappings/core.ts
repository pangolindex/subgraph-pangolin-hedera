/* eslint-disable prefer-const */
import {BigInt, BigDecimal, store, Address} from '@graphprotocol/graph-ts'
import {
    Token,
    Pair,
    PangolinFactory,
    Transaction,
    Mint as MintEvent,
    Burn as BurnEvent,
    Swap as SwapEvent,
    Bundle,
} from '../../generated/schema'
import {LogicalMint, LogicalBurn, Mint, Burn, Swap, Sync} from '../../generated/templates/Pair/Pair'
import {updatePairDayData, updateTokenDayData, updatePangolinDayData, updatePairHourData} from './dayUpdates'
import {getAVAXPriceInUSD, findEthPerToken, getTrackedVolumeUSD, getTrackedLiquidityUSD} from './pricing'
import {
    convertTokenToDecimal,
    ADDRESS_ZERO,
    ROUTER_ADDRESS,
    ONE_BI,
    ZERO_BD,
    BI_MINIMUM_LIQUIDITY,
} from './helpers'

function isCompleteMint(mintId: string): boolean {
    return MintEvent.load(mintId)!.sender !== null // sufficient checks
}

export function handleLogicalMint(event: LogicalMint): void {
    let eventHashAsHexString = event.transaction.hash.toHexString()

    // ignore initial mint for first adds
    if (event.params.to.toHexString() == ADDRESS_ZERO && event.params.value.equals(BI_MINIMUM_LIQUIDITY)) {
        return
    }

    let transaction = Transaction.load(eventHashAsHexString)
    if (transaction === null) {
        transaction = new Transaction(eventHashAsHexString)
        transaction.blockNumber = event.block.number
        transaction.timestamp = event.block.timestamp
        transaction.mints = []
        transaction.burns = []
        transaction.swaps = []
    }

    let value = event.params.value

    let pair = Pair.load(event.address.toHexString())!
    pair.totalSupply = pair.totalSupply.plus(value)
    pair.save()

    let mints = transaction.mints

    // create new mint if no mints so far or if last one is done already
    if (mints.length === 0 || isCompleteMint(mints[mints.length - 1])) {
        let mint = new MintEvent(
            eventHashAsHexString
                .concat('-')
                .concat(BigInt.fromI32(mints.length).toString())
        )
        mint.transaction = transaction.id
        mint.pair = pair.id
        mint.to = event.params.to
        mint.liquidity = value
        mint.timestamp = transaction.timestamp
        mint.transaction = transaction.id
        mint.save()

        transaction.mints = mints.concat([mint.id])
    } else {
        // previous mint is actually a fee switch mint
        // this mint is the traditional mint
        let mint = MintEvent.load(mints[mints.length - 1])!
        mint.feeTo = mint.to
        mint.to = event.params.to
        mint.feeLiquidity = mint.liquidity
        mint.liquidity = value
        mint.save()
    }

    transaction.save()
}

export function handleLogicalBurn(event: LogicalBurn): void {
    let eventHashAsHexString = event.transaction.hash.toHexString()

    let transaction = Transaction.load(eventHashAsHexString)
    if (transaction === null) {
        transaction = new Transaction(eventHashAsHexString)
        transaction.blockNumber = event.block.number
        transaction.timestamp = event.block.timestamp
        transaction.mints = []
        transaction.burns = []
        transaction.swaps = []
    }

    let value = event.params.value
    let pair = Pair.load(event.address.toHexString())!
    pair.totalSupply = pair.totalSupply.minus(value)
    pair.save()

    let mints = transaction.mints
    let burns = transaction.burns

    let burn = new BurnEvent(
        eventHashAsHexString
            .concat('-')
            .concat(BigInt.fromI32(burns.length).toString())
    )
    burn.transaction = transaction.id
    burn.pair = pair.id
    burn.liquidity = value
    burn.timestamp = transaction.timestamp

    // if this logical burn included a fee mint, account for this
    if (mints.length !== 0 && !isCompleteMint(mints[mints.length - 1])) {
        let mint = MintEvent.load(mints[mints.length - 1])!
        burn.feeTo = mint.to
        burn.feeLiquidity = mint.liquidity

        store.remove('Mint', mints[mints.length - 1])
        mints.pop()
        transaction.mints = mints
    }

    burn.save()
    transaction.burns = burns.concat([burn.id])
    transaction.save()
}

export function handleSync(event: Sync): void {
    let pair = Pair.load(event.address.toHexString())!
    let token0 = Token.load(pair.token0)!
    let token1 = Token.load(pair.token1)!
    let pangolin = PangolinFactory.load('1')!

    // reset factory liquidity by subtracting only tracked liquidity
    pangolin.totalLiquidityETH = pangolin.totalLiquidityETH.minus(pair.trackedReserveETH as BigDecimal)

    // reset token total liquidity amounts
    token0.totalLiquidity = token0.totalLiquidity.minus(pair.reserve0)
    token1.totalLiquidity = token1.totalLiquidity.minus(pair.reserve1)

    pair.reserve0 = convertTokenToDecimal(event.params.reserve0, token0.decimals)
    pair.reserve1 = convertTokenToDecimal(event.params.reserve1, token1.decimals)

    if (pair.reserve1.notEqual(ZERO_BD)) pair.token0Price = pair.reserve0.div(pair.reserve1)
    else pair.token0Price = ZERO_BD
    if (pair.reserve0.notEqual(ZERO_BD)) pair.token1Price = pair.reserve1.div(pair.reserve0)
    else pair.token1Price = ZERO_BD

    pair.save()

    // update ETH price now that reserves could have changed
    let bundle = Bundle.load('1')!
    bundle.ethPrice = getAVAXPriceInUSD()
    bundle.save()

    token0.derivedETH = findEthPerToken(token0 as Token)
    token0.derivedUSD = token0.derivedETH.times(bundle.ethPrice)
    token1.derivedETH = findEthPerToken(token1 as Token)
    token1.derivedUSD = token1.derivedETH.times(bundle.ethPrice)
    token0.save()
    token1.save()

    // get tracked liquidity - will be 0 if neither is in whitelist
    let trackedLiquidityETH: BigDecimal
    if (bundle.ethPrice.notEqual(ZERO_BD)) {
        trackedLiquidityETH = getTrackedLiquidityUSD(pair.reserve0, token0 as Token, pair.reserve1, token1 as Token).div(
            bundle.ethPrice
        )
    } else {
        trackedLiquidityETH = ZERO_BD
    }

    // use derived amounts within pair
    pair.trackedReserveETH = trackedLiquidityETH
    pair.reserveETH = pair.reserve0
        .times(token0.derivedETH as BigDecimal)
        .plus(pair.reserve1.times(token1.derivedETH as BigDecimal))
    pair.reserveUSD = pair.reserveETH.times(bundle.ethPrice)

    // use tracked amounts globally
    pangolin.totalLiquidityETH = pangolin.totalLiquidityETH.plus(trackedLiquidityETH)
    pangolin.totalLiquidityUSD = pangolin.totalLiquidityETH.times(bundle.ethPrice)

    // now correctly set liquidity amounts for each token
    token0.totalLiquidity = token0.totalLiquidity.plus(pair.reserve0)
    token1.totalLiquidity = token1.totalLiquidity.plus(pair.reserve1)

    // save entities
    pair.save()
    pangolin.save()
    token0.save()
    token1.save()
}

export function handleMint(event: Mint): void {
    let transaction = Transaction.load(event.transaction.hash.toHexString())!
    let mints = transaction.mints
    let mint = MintEvent.load(mints[mints.length - 1])!

    let pair = Pair.load(event.address.toHexString())!
    let pangolin = PangolinFactory.load('1')!

    let token0 = Token.load(pair.token0)!
    let token1 = Token.load(pair.token1)!

    // update exchange info (except balances, sync will cover that)
    let token0Amount = convertTokenToDecimal(event.params.amount0, token0.decimals)
    let token1Amount = convertTokenToDecimal(event.params.amount1, token1.decimals)

    // update txn counts
    token0.txCount = token0.txCount.plus(ONE_BI)
    token1.txCount = token1.txCount.plus(ONE_BI)

    // get new amounts of USD and ETH for tracking
    let bundle = Bundle.load('1')!
    let amountTotalUSD = token1.derivedETH
        .times(token1Amount)
        .plus(token0.derivedETH.times(token0Amount))
        .times(bundle.ethPrice)

    // update txn counts
    pair.txCount = pair.txCount.plus(ONE_BI)
    pangolin.txCount = pangolin.txCount.plus(ONE_BI)

    // save entities
    token0.save()
    token1.save()
    pair.save()
    pangolin.save()

    mint.sender = event.params.sender
    mint.amount0 = token0Amount as BigDecimal
    mint.amount1 = token1Amount as BigDecimal
    mint.logIndex = event.logIndex
    mint.amountUSD = amountTotalUSD as BigDecimal
    mint.save()

    // update day entities
    updatePairDayData(event)
    updatePairHourData(event)
    updatePangolinDayData(event)
    updateTokenDayData(token0 as Token, event)
    updateTokenDayData(token1 as Token, event)
}

export function handleBurn(event: Burn): void {
    let transaction = Transaction.load(event.transaction.hash.toHexString())!
    let burns = transaction.burns
    let burn = BurnEvent.load(burns[burns.length - 1])!

    let pair = Pair.load(event.address.toHexString())!
    let pangolin = PangolinFactory.load('1')!

    //update token info
    let token0 = Token.load(pair.token0)!
    let token1 = Token.load(pair.token1)!
    let token0Amount = convertTokenToDecimal(event.params.amount0, token0.decimals)
    let token1Amount = convertTokenToDecimal(event.params.amount1, token1.decimals)

    // update txn counts
    token0.txCount = token0.txCount.plus(ONE_BI)
    token1.txCount = token1.txCount.plus(ONE_BI)

    // get new amounts of USD and ETH for tracking
    let bundle = Bundle.load('1')!
    let amountTotalUSD = token1.derivedETH
        .times(token1Amount)
        .plus(token0.derivedETH.times(token0Amount))
        .times(bundle.ethPrice)

    // update txn counts
    pangolin.txCount = pangolin.txCount.plus(ONE_BI)
    pair.txCount = pair.txCount.plus(ONE_BI)

    // update global counter and save
    token0.save()
    token1.save()
    pair.save()
    pangolin.save()

    // update burn
    burn.amount0 = token0Amount as BigDecimal
    burn.amount1 = token1Amount as BigDecimal
    burn.logIndex = event.logIndex
    burn.amountUSD = amountTotalUSD as BigDecimal
    burn.save()

    // update day entities
    updatePairDayData(event)
    updatePairHourData(event)
    updatePangolinDayData(event)
    updateTokenDayData(token0 as Token, event)
    updateTokenDayData(token1 as Token, event)
}

export function handleSwap(event: Swap): void {
    // check if sender and dest are equal to the router
    // if so, change the to address to the tx issuer
    let dest: Address
    if (event.params.sender == Address.fromString(ROUTER_ADDRESS) && event.params.to == Address.fromString(ROUTER_ADDRESS)) {
        dest = event.transaction.from
    } else {
        dest = event.params.to
    }

    let pair = Pair.load(event.address.toHexString())!
    let token0 = Token.load(pair.token0)!
    let token1 = Token.load(pair.token1)!
    let amount0In = convertTokenToDecimal(event.params.amount0In, token0.decimals)
    let amount1In = convertTokenToDecimal(event.params.amount1In, token1.decimals)
    let amount0Out = convertTokenToDecimal(event.params.amount0Out, token0.decimals)
    let amount1Out = convertTokenToDecimal(event.params.amount1Out, token1.decimals)

    // totals for volume updates
    let amount0Total = amount0Out.plus(amount0In)
    let amount1Total = amount1Out.plus(amount1In)

    // ETH/USD prices
    let bundle = Bundle.load('1')!

    // get total amounts of derived USD and ETH for tracking
    let derivedAmountETH = token1.derivedETH
        .times(amount1Total)
        .plus(token0.derivedETH.times(amount0Total))
        .div(BigDecimal.fromString('2'))
    let derivedAmountUSD = derivedAmountETH.times(bundle.ethPrice)

    // only accounts for volume through white listed tokens
    let trackedAmountUSD = getTrackedVolumeUSD(amount0Total, token0 as Token, amount1Total, token1 as Token)

    let trackedAmountETH: BigDecimal
    if (bundle.ethPrice.equals(ZERO_BD)) {
        trackedAmountETH = ZERO_BD
    } else {
        trackedAmountETH = trackedAmountUSD.div(bundle.ethPrice)
    }

    // update token0 global volume and token liquidity stats
    token0.tradeVolume = token0.tradeVolume.plus(amount0In.plus(amount0Out))
    token0.tradeVolumeUSD = token0.tradeVolumeUSD.plus(trackedAmountUSD)
    token0.untrackedVolumeUSD = token0.untrackedVolumeUSD.plus(derivedAmountUSD)

    // update token1 global volume and token liquidity stats
    token1.tradeVolume = token1.tradeVolume.plus(amount1In.plus(amount1Out))
    token1.tradeVolumeUSD = token1.tradeVolumeUSD.plus(trackedAmountUSD)
    token1.untrackedVolumeUSD = token1.untrackedVolumeUSD.plus(derivedAmountUSD)

    // update txn counts
    token0.txCount = token0.txCount.plus(ONE_BI)
    token1.txCount = token1.txCount.plus(ONE_BI)

    // update pair volume data, use tracked amount if we have it as its probably more accurate
    pair.volumeUSD = pair.volumeUSD.plus(trackedAmountUSD)
    pair.volumeToken0 = pair.volumeToken0.plus(amount0Total)
    pair.volumeToken1 = pair.volumeToken1.plus(amount1Total)
    pair.untrackedVolumeUSD = pair.untrackedVolumeUSD.plus(derivedAmountUSD)
    pair.txCount = pair.txCount.plus(ONE_BI)

    // update global values, only used tracked amounts for volume
    let pangolin = PangolinFactory.load('1')!
    pangolin.totalVolumeUSD = pangolin.totalVolumeUSD.plus(trackedAmountUSD)
    pangolin.totalVolumeETH = pangolin.totalVolumeETH.plus(trackedAmountETH)
    pangolin.untrackedVolumeUSD = pangolin.untrackedVolumeUSD.plus(derivedAmountUSD)
    pangolin.txCount = pangolin.txCount.plus(ONE_BI)

    // save entities
    pair.save()
    token0.save()
    token1.save()
    pangolin.save()

    let transaction = Transaction.load(event.transaction.hash.toHexString())
    if (transaction === null) {
        transaction = new Transaction(event.transaction.hash.toHexString())
        transaction.blockNumber = event.block.number
        transaction.timestamp = event.block.timestamp
        transaction.mints = []
        transaction.swaps = []
        transaction.burns = []
    }
    let swaps = transaction.swaps
    let swap = new SwapEvent(
        event.transaction.hash
            .toHexString()
            .concat('-')
            .concat(BigInt.fromI32(swaps.length).toString())
    )

    // update swap event
    swap.transaction = transaction.id
    swap.pair = pair.id
    swap.timestamp = transaction.timestamp
    swap.transaction = transaction.id
    swap.sender = event.params.sender
    swap.amount0In = amount0In
    swap.amount1In = amount1In
    swap.amount0Out = amount0Out
    swap.amount1Out = amount1Out
    swap.to = dest
    swap.from = event.transaction.from
    swap.logIndex = event.logIndex
    // use the tracked amount if we have it
    swap.amountUSD = trackedAmountUSD === ZERO_BD ? derivedAmountUSD : trackedAmountUSD
    swap.save()

    // update the transaction
    transaction.swaps = swaps.concat([swap.id])
    transaction.save()

    // update day entities
    let pairDayData = updatePairDayData(event)
    let pairHourData = updatePairHourData(event)
    let pangolinDayData = updatePangolinDayData(event)
    let token0DayData = updateTokenDayData(token0 as Token, event)
    let token1DayData = updateTokenDayData(token1 as Token, event)

    // swap specific updating
    pangolinDayData.dailyVolumeUSD = pangolinDayData.dailyVolumeUSD.plus(trackedAmountUSD)
    pangolinDayData.dailyVolumeETH = pangolinDayData.dailyVolumeETH.plus(trackedAmountETH)
    pangolinDayData.dailyVolumeUntracked = pangolinDayData.dailyVolumeUntracked.plus(derivedAmountUSD)
    pangolinDayData.save()

    // swap specific updating for pair
    pairDayData.dailyVolumeToken0 = pairDayData.dailyVolumeToken0.plus(amount0Total)
    pairDayData.dailyVolumeToken1 = pairDayData.dailyVolumeToken1.plus(amount1Total)
    pairDayData.dailyVolumeUSD = pairDayData.dailyVolumeUSD.plus(trackedAmountUSD)
    pairDayData.save()

    // update hourly pair data
    pairHourData.hourlyVolumeToken0 = pairHourData.hourlyVolumeToken0.plus(amount0Total)
    pairHourData.hourlyVolumeToken1 = pairHourData.hourlyVolumeToken1.plus(amount1Total)
    pairHourData.hourlyVolumeUSD = pairHourData.hourlyVolumeUSD.plus(trackedAmountUSD)
    pairHourData.save()

    // swap specific updating for token0
    token0DayData.dailyVolumeToken = token0DayData.dailyVolumeToken.plus(amount0Total)
    token0DayData.dailyVolumeETH = token0DayData.dailyVolumeETH.plus(amount0Total.times(token0.derivedETH as BigDecimal))
    token0DayData.dailyVolumeUSD = token0DayData.dailyVolumeUSD.plus(
        amount0Total.times(token0.derivedETH as BigDecimal).times(bundle.ethPrice)
    )
    token0DayData.save()

    // swap specific updating
    token1DayData.dailyVolumeToken = token1DayData.dailyVolumeToken.plus(amount1Total)
    token1DayData.dailyVolumeETH = token1DayData.dailyVolumeETH.plus(amount1Total.times(token1.derivedETH as BigDecimal))
    token1DayData.dailyVolumeUSD = token1DayData.dailyVolumeUSD.plus(
        amount1Total.times(token1.derivedETH as BigDecimal).times(bundle.ethPrice)
    )
    token1DayData.save()
}
