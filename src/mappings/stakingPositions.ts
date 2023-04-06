import {BigInt, store} from "@graphprotocol/graph-ts"
import {SingleSideStaking, StakingPosition} from "../../generated/schema"
import {ZERO_BI} from "./helpers"
import {
    Staked,
    Withdrawn,
    PeriodEnded,
    RewardAdded,
    PeriodDurationUpdated,
    Evicted,
    SetRentInTinyBars,
} from "../../generated/StakingPositions/PangolinStakingPositions"

// These values are hardcoded in PangolinStakingPositions
let PANGOLIN_STAKING_POSITIONS_INITIAL_PERIOD_DURATION = BigInt.fromI32(14 * 86400)
let PANGOLIN_STAKING_POSITIONS_INITIAL_RENT = BigInt.fromI32(-1)


export function handleStaked(event: Staked): void {
    const singleSideStaking = getSingleSideStaking()
    const stakingPosition = getStakingPosition(event.params.positionId)

    const totalAmount = event.params.amount.plus(event.params.reward)
    const addedEntryTimes = event.block.timestamp.times(totalAmount)

    singleSideStaking.balance = singleSideStaking.balance.plus(totalAmount)
    singleSideStaking.sumOfEntryTimes = singleSideStaking.sumOfEntryTimes.plus(addedEntryTimes)
    singleSideStaking.lastUpdate = event.block.timestamp
    singleSideStaking.save()

    stakingPosition.balance = stakingPosition.balance.plus(totalAmount)
    stakingPosition.sumOfEntryTimes = stakingPosition.sumOfEntryTimes.plus(addedEntryTimes)
    stakingPosition.lastUpdate = event.block.timestamp
    stakingPosition.save()
}

export function handleWithdrawn(event: Withdrawn): void {
    const singleSideStaking = getSingleSideStaking()
    const stakingPosition = getStakingPosition(event.params.positionId)

    const remaining = stakingPosition.balance.minus(event.params.amount)
    const newEntryTimes = event.block.timestamp.times(remaining)

    singleSideStaking.balance = singleSideStaking.balance.minus(event.params.amount)
    singleSideStaking.sumOfEntryTimes = singleSideStaking.sumOfEntryTimes.plus(newEntryTimes).minus(stakingPosition.sumOfEntryTimes)
    singleSideStaking.lastUpdate = event.block.timestamp
    singleSideStaking.save()

    stakingPosition.balance = remaining
    stakingPosition.sumOfEntryTimes = newEntryTimes
    stakingPosition.lastUpdate = event.block.timestamp
    stakingPosition.lastDevaluation = event.block.timestamp
    stakingPosition.save()
}

export function handlePeriodEnded(event: PeriodEnded): void {
    const singleSideStaking = getSingleSideStaking()
    const leftover = (singleSideStaking.periodFinish.minus(event.block.timestamp)).times(singleSideStaking.rewardRate)
    singleSideStaking.totalRewardAdded = singleSideStaking.totalRewardAdded.minus(leftover)
    singleSideStaking.periodFinish = event.block.timestamp
    singleSideStaking.save()
}

export function handleRewardAdded(event: RewardAdded): void {
    const newReward = event.params.reward
    const singleSideStaking = getSingleSideStaking()
    singleSideStaking.totalRewardAdded = singleSideStaking.totalRewardAdded.plus(newReward)
    if (singleSideStaking.lastUpdate.ge(singleSideStaking.periodFinish)) {
        singleSideStaking.rewardRate = newReward.div(singleSideStaking.periodDuration)
    } else {
        const leftover = (singleSideStaking.periodFinish.minus(singleSideStaking.lastUpdate)).times(singleSideStaking.rewardRate)
        singleSideStaking.rewardRate = (newReward.plus(leftover)).div(singleSideStaking.periodDuration)
    }
    singleSideStaking.lastUpdate = event.block.timestamp
    singleSideStaking.periodFinish = event.block.timestamp.plus(singleSideStaking.periodDuration)
    singleSideStaking.save()
}

export function handlePeriodDurationUpdated(event: PeriodDurationUpdated): void {
    const singleSideStaking = getSingleSideStaking()
    singleSideStaking.periodDuration = event.params.newDuration
    singleSideStaking.save()
}

export function handleEvicted(event: Evicted): void {
    const singleSideStaking = getSingleSideStaking()
    const stakingPosition = getStakingPosition(event.params.positionId)

    singleSideStaking.lastUpdate = event.block.timestamp
    singleSideStaking.save()

    store.remove('StakingPosition', stakingPosition.id)
}

export function handleSetRentInTinyBars(event: SetRentInTinyBars): void {
    const singleSideStaking = getSingleSideStaking()
    // Technically the rentInTinyBars storage value could be negative but will be emitted (and indexed) as 0
    singleSideStaking.rentInTinyBars = event.params.rent
    singleSideStaking.save()
}


/***********
 * Helpers *
 ***********/

function getSingleSideStaking(): SingleSideStaking {
    let singleSideStaking = SingleSideStaking.load('1')

    if (singleSideStaking === null) {
        singleSideStaking = new SingleSideStaking('1')
        singleSideStaking.totalRewardAdded = ZERO_BI
        singleSideStaking.rewardRate = ZERO_BI
        singleSideStaking.periodDuration = PANGOLIN_STAKING_POSITIONS_INITIAL_PERIOD_DURATION
        singleSideStaking.periodFinish = ZERO_BI
        singleSideStaking.balance = ZERO_BI
        singleSideStaking.sumOfEntryTimes = ZERO_BI
        singleSideStaking.lastUpdate = ZERO_BI
        singleSideStaking.rentInTinyBars = PANGOLIN_STAKING_POSITIONS_INITIAL_RENT
        singleSideStaking.save()
    }

    return singleSideStaking
}

function getStakingPosition(
    positionId: BigInt
): StakingPosition {
    const stakingPositionKey = positionId.toHexString()

    let stakingPosition = StakingPosition.load(stakingPositionKey)

    if (stakingPosition === null) {
        stakingPosition = new StakingPosition(stakingPositionKey)
        stakingPosition.balance = ZERO_BI
        stakingPosition.sumOfEntryTimes = ZERO_BI
        stakingPosition.lastUpdate = ZERO_BI
        stakingPosition.lastDevaluation = ZERO_BI
        stakingPosition.save()
    }

    return stakingPosition
}