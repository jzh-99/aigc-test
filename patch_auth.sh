sed -i '/const accessToken = signAccessToken({ id: user.id, account: user.account, role: user.role })/i \
    // Revoke all older refresh tokens to enforce single session\
    await db\
      .updateTable('\''refresh_tokens'\'')\
      .set({ revoked_at: sql`NOW()` })\
      .where('\''user_id'\'', '\'='\'', user.id)\
      .where('\''revoked_at'\'', '\''is'\'', null)\
      .execute()\
\
    // Publish kick event to other devices\
    await redis.publish(`user:kick:${user.id}`, JSON.stringify({ reason: '\''new_login'\'' }))\
' apps/api/src/routes/auth.ts
