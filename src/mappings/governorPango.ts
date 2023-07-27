import {Bytes} from '@graphprotocol/graph-ts';
import {Proposal} from '../../generated/schema';
import {
    ProposalCreated,
    ProposalCanceled,
    ProposalExecuted,
    VoteCast,
    ProposalQueued,
} from '../../generated/GovernorPango/GovernorPango';
import {ZERO_BI} from './helpers';

export function handleNewProposal(event: ProposalCreated): void {
    const proposal = new Proposal(event.params.id.toString());

    // @ts-ignore;
    proposal.targets = changetype<Array<Bytes>>(event.params.targets);
    proposal.values = event.params.values;
    proposal.signatures = event.params.signatures;
    proposal.calldatas = event.params.calldatas;

    proposal.forVotes = ZERO_BI;
    proposal.againstVotes = ZERO_BI;

    proposal.startTime = event.params.startTime;
    proposal.endTime = event.params.endTime;

    proposal.description = event.params.description;

    proposal.executed = false;
    proposal.canceled = false;

    proposal.save();
}

export function handleProposalCanceled(event: ProposalCanceled): void {
    const proposal = Proposal.load(event.params.id.toString())!;
    proposal.canceled = true;
    proposal.save();
}

export function handleProposalExecuted(event: ProposalExecuted): void {
    const proposal = Proposal.load(event.params.id.toString())!;
    proposal.executed = true;
    proposal.save();
}

export function handleVoteCast(event: VoteCast): void {
    const proposal = Proposal.load(event.params.proposalId.toString())!;
    if (event.params.support) {
        proposal.forVotes = proposal.forVotes.plus(event.params.votes);
    } else {
        proposal.againstVotes = proposal.againstVotes.plus(event.params.votes);
    }
    proposal.save();
}

export function handleProposalQueued(event: ProposalQueued): void {
    const proposal = Proposal.load(event.params.id.toString())!;
    proposal.eta = event.params.eta;
    proposal.save();
}
