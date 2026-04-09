sed -i '/import { authEventsRoutes } from '\''\.\/routes\/auth-events\.js'\''/d' /root/autodl-tmp/aigc-test/apps/api/src/app.ts
sed -i '/await v1\.register(authEventsRoutes)/d' /root/autodl-tmp/aigc-test/apps/api/src/app.ts
sed -i '/'\''\/api\/v1\/auth\/events'\'',/d' /root/autodl-tmp/aigc-test/apps/api/src/plugins/jwt-auth.ts
