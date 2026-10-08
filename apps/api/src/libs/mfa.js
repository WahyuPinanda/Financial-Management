// Decode claims only after Supabase getUser has verified this exact access token.
function needsMfa(user, token) {
  if (!user.factors?.some((factor) => factor.status === 'verified')) return false;
  try {
    return (
      JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).aal !== 'aal2'
    );
  } catch {
    return true;
  }
}
module.exports = { needsMfa };
