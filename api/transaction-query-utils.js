function buildTransactionIdQuery(transactionId) {
  const query = { $or: [{ _id: transactionId }] };
  const numericId = Number.parseInt(transactionId, 10);
  if (!Number.isNaN(numericId)) {
    query.$or.push({ _id: numericId });
    query.$or.push({ _id: `${transactionId}` });
  }
  return query;
}

function buildReferenceIdQuery(fieldName, referenceId) {
  const query = { $or: [{ [fieldName]: referenceId }] };
  const numericId = Number.parseInt(referenceId, 10);
  if (!Number.isNaN(numericId)) {
    query.$or.push({ [fieldName]: numericId });
    query.$or.push({ [fieldName]: `${referenceId}` });
  }
  return query;
}

module.exports = {
  buildTransactionIdQuery,
  buildReferenceIdQuery
};
