export function reviewKind(review){
 if(!review||review.sentHash)throw Error('Submitted transactions cannot be refreshed. Check the receipt.');
 const kind=review.recovery?.kind||'';
 return ['atomic.buy','atomic.sell'].includes(kind)?'atomic':kind==='swap'?'swap':kind.startsWith('funding.')?'funding':kind.startsWith('liquidation.')?'liquidation':'simulation';
}
// Refresh never sends a transaction. A new review is required even when its minimum changes.
export async function renewReview(review,handlers){
 const kind=reviewKind(review);
 await handlers.assertWallet(review.account);
 await handlers.checkPending(review);
 return handlers[kind](review);
}
