import { getTopicClaims, type Topic, type ReportMessage } from '@/types/report';

/** Overview keeps quote tooltips; claim conversations load on expansion. */
export function reportTopicPreview(topic: Topic): Topic {
    const seen = new Set<string>();
    const messages: ReportMessage[] = topic.messages?.length ? topic.messages : getTopicClaims(topic).flatMap(claim =>
        claim.quotes.filter(quote => {
            if (seen.has(quote.reference.messageId)) return false;
            seen.add(quote.reference.messageId); return true;
        }).map(quote => ({
            id: quote.reference.messageId, content: quote.text, timestamp: 0,
            category: claim.stance, subCategory: '', intent: '', isSubstantive: true,
            sentiment: claim.stance === 'support' ? 'positive' as const : claim.stance === 'oppose' ? 'negative' as const : 'neutral' as const,
        })));
    return { ...topic, messages, claims: undefined,
        subtopics: topic.subtopics?.map(subtopic => ({ ...subtopic, claims: [] })) };
}
