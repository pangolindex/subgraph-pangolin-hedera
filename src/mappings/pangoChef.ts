import {Address, BigInt} from "@graphprotocol/graph-ts"
import {Farm, FarmingPosition, FarmReward, FarmRewarder, PangoChef, Pair, Token, User} from "../../generated/schema"
import {
    convertTokenToDecimal,
    ZERO_BI,
    ZERO_BD,
    PNG_ADDRESS,
    PGL_DECIMALS,
    ONE_BI,
    ADDRESS_ZERO,
    _fetchRewardTokens,
    _fetchRewardMultipliers,
} from "./helpers"
import {
    PeriodDurationUpdated,
    PeriodEnded,
    PoolInitialized,
    RewardAdded,
    RewarderSet,
    Staked,
    WeightSet,
    Withdrawn,
} from "../../generated/PangoChef/PangoChef"

// Both of these values are hardcoded in PangoChef
let PANGO_CHEF_INITIAL_WEIGHT = BigInt.fromI32(1000)
let PANGO_CHEF_INITIAL_PERIOD_DURATION = BigInt.fromI32(86400)

export function handlePoolInitialized(event: PoolInitialized): void {
    const chefAddress = event.address
    const pid = event.params.poolId
    const rewarderAddress = Address.zero()

    const chefKey = chefAddress.toHexString()
    const farmKey = chefAddress.toHexString() + "-" + pid.toHexString()
    const rewarderKey = rewarderAddress.toHexString() + "-" + pid.toHexString()

    let chef = PangoChef.load(chefKey)

    // If chef is null, PangoChef is being constructed and is creating the zero pool (WNAT-PNG)
    if (chef === null) {
        chef = new PangoChef(chefKey)
        chef.totalRewardAdded = ZERO_BI
        chef.totalWeight = PANGO_CHEF_INITIAL_WEIGHT
        chef.rewardRate = ZERO_BI
        chef.periodDuration = PANGO_CHEF_INITIAL_PERIOD_DURATION
        chef.periodFinish = ZERO_BI
        chef.save()
    }

    const farm = new Farm(farmKey)
    farm.pid = pid
    farm.tokenOrRecipientAddress = event.params.tokenOrRecipient
    farm.weight = pid.isZero() ? PANGO_CHEF_INITIAL_WEIGHT : ZERO_BI
    farm.tvl = ZERO_BD
    farm.rewarder = rewarderKey
    farm.chef = chefKey

    // Conditionally add Pair if the Farm recipient is a known pair
    const pairContractAddressHexString = event.params.pairContract.toHexString()
    if (pairContractAddressHexString != ADDRESS_ZERO) {
        const nullablePair = Pair.load(pairContractAddressHexString)
        if (nullablePair != null) {
            farm.pair = nullablePair.id
        }
    }

    farm.save()

    createFarmRewarder(chefAddress, rewarderAddress, pid)
}

export function handleStaked(event: Staked): void {
    const chefAddress = event.address
    const pid = event.params.positionId
    const farmKey = chefAddress.toHexString() + "-" + pid.toHexString()
    const convertedAmount = convertTokenToDecimal(event.params.amount, PGL_DECIMALS)

    const farm = Farm.load(farmKey)!
    farm.tvl = farm.tvl.plus(convertedAmount)
    farm.save()

    createUser(event.params.userId)

    const toUserStakingPosition = createStakingPosition(
        chefAddress,
        event.params.userId,
        farm.pid
    )
    toUserStakingPosition.stakedTokenBalance = toUserStakingPosition.stakedTokenBalance.plus(
        convertedAmount
    )
    toUserStakingPosition.save()
}

export function handleWithdrawn(event: Withdrawn): void {
    const chefAddress = event.address
    const farmKey = chefAddress.toHexString() + "-" + event.params.positionId.toHexString()
    const convertedAmount = convertTokenToDecimal(event.params.amount, PGL_DECIMALS)

    const farm = Farm.load(farmKey)!
    farm.tvl = farm.tvl.minus(convertedAmount)
    farm.save()

    createUser(event.params.userId)

    const fromUserStakingPosition = createStakingPosition(
        chefAddress,
        event.params.userId,
        farm.pid
    )
    fromUserStakingPosition.stakedTokenBalance = fromUserStakingPosition.stakedTokenBalance.minus(
        convertedAmount
    )
    fromUserStakingPosition.save()
}

export function handleRewarderSet(event: RewarderSet): void {
    const chefAddress = event.address
    const pid = event.params.poolId
    const rewarderAddress = event.params.rewarder
    const farmKey = chefAddress.toHexString() + "-" + pid.toHexString()
    const rewarderKey = rewarderAddress.toHexString() + "-" + pid.toHexString()

    const farm = Farm.load(farmKey)!
    farm.rewarder = rewarderKey
    farm.save()

    createFarmRewarder(chefAddress, rewarderAddress, pid)
}

export function handleWeightSet(event: WeightSet): void {
    const chefAddress = event.address
    const pid = event.params.poolId
    const newWeight = event.params.newWeight
    const farmKey = chefAddress.toHexString() + "-" + pid.toHexString()

    const farm = Farm.load(farmKey)!

    const chef = PangoChef.load(chefAddress.toHexString())!
    chef.totalWeight = chef.totalWeight.minus(farm.weight).plus(newWeight)
    chef.save()

    farm.weight = newWeight
    farm.save()
}

export function handlePeriodEnded(event: PeriodEnded): void {
    const chefAddress = event.address
    const blockTime = event.block.timestamp
    const chef = PangoChef.load(chefAddress.toHexString())!
    const leftover = (chef.periodFinish.minus(event.block.timestamp)).times(chef.rewardRate)
    chef.totalRewardAdded = chef.totalRewardAdded.minus(leftover)
    chef.periodFinish = blockTime
    chef.save()
}

export function handleRewardAdded(event: RewardAdded): void {
    const chefAddress = event.address
    const blockTime = event.block.timestamp
    const newReward = event.params.reward
    const chef = PangoChef.load(chefAddress.toHexString())!
    chef.totalRewardAdded = chef.totalRewardAdded.plus(newReward)
    if (blockTime.ge(chef.periodFinish)) {
        chef.rewardRate = newReward.div(chef.periodDuration)
    } else {
        const leftover = (chef.periodFinish.minus(event.block.timestamp)).times(chef.rewardRate)
        chef.rewardRate = (newReward.plus(leftover)).div(chef.periodDuration)
    }
    chef.periodFinish = blockTime.plus(chef.periodDuration)
    chef.save()
}

export function handlePeriodDurationUpdated(event: PeriodDurationUpdated): void {
    const chefAddress = event.address
    const newDuration = event.params.newDuration
    const chef = PangoChef.load(chefAddress.toHexString())!
    chef.periodDuration = newDuration
    chef.save()
}


/***********
 * Helpers *
 ***********/

function createUser(userAddress: Address): void {
    let user = User.load(userAddress.toHexString())
    if (user === null) {
        user = new User(userAddress.toHexString())
        user.usdSwapped = ZERO_BD
        user.save()
    }
}

export function createFarmRewarder(
    chefAddress: Address,
    rewarderAddress: Address,
    pid: BigInt
): void {
    const farmKey = chefAddress.toHexString() + "-" + pid.toHexString()
    const farmRewarderKey = rewarderAddress.toHexString() + "-" + pid.toHexString()

    let farmRewarder = FarmRewarder.load(farmRewarderKey)
    if (farmRewarder === null) {
        farmRewarder = new FarmRewarder(farmRewarderKey)
        farmRewarder.farm = farmKey
        farmRewarder.save()

        // Default PNG reward
        createFarmReward(rewarderAddress, pid, Address.fromString(PNG_ADDRESS), ONE_BI)

        if (rewarderAddress.toHexString() != ADDRESS_ZERO) {
            const rewardTokens = _fetchRewardTokens(rewarderAddress)
            const multipliers = _fetchRewardMultipliers(rewarderAddress)

            for (let i = 0; i < rewardTokens.length; ++i) {
                createFarmReward(rewarderAddress, pid, rewardTokens[i], multipliers[i])
            }
        }
    }
}

function createFarmReward(
    rewarderAddress: Address,
    pid: BigInt,
    rewardTokenAddress: Address,
    multiplier: BigInt
): void {
    const farmRewardKey = rewarderAddress.toHexString() + "-" + rewardTokenAddress.toHexString() + "-" + pid.toString()
    const rewarderKey = rewarderAddress.toHexString() + "-" + pid.toHexString()

    const farmReward = new FarmReward(farmRewardKey)
    farmReward.multiplier = multiplier
    farmReward.rewarder = rewarderKey
    farmReward.tokenAddress = rewardTokenAddress

    // Only add token if the subgraph has already indexed it via a PangolinPair
    const token = Token.load(rewardTokenAddress.toHexString())
    if (token !== null) {
        farmReward.token = token.id
    }

    farmReward.save()
}

function createStakingPosition(
    chefAddress: Address,
    userAddress: Address,
    pid: BigInt
): FarmingPosition {
    const farmingPositionKey = userAddress.toHexString() + "-" + pid.toHexString()

    let farmingPosition = FarmingPosition.load(farmingPositionKey)

    if (farmingPosition === null) {
        const farmKey = chefAddress.toHexString() + "-" + pid.toHexString()
        farmingPosition = new FarmingPosition(farmingPositionKey)
        farmingPosition.stakedTokenBalance = ZERO_BD
        farmingPosition.farm = farmKey
        farmingPosition.user = userAddress.toHexString()
        farmingPosition.save()
    }

    return farmingPosition
}

