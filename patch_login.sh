sed -i 's/import { useRouter } from '\''next\/navigation'\''/import { useRouter, useSearchParams } from '\''next\/navigation'\''/g' /root/autodl-tmp/aigc-test/apps/web/src/app/\(auth\)/login/page.tsx

sed -i '/const router = useRouter()/a \
  const searchParams = useSearchParams()\
  const isKicked = searchParams.get('\''reason'\'') === '\''kicked'\''' /root/autodl-tmp/aigc-test/apps/web/src/app/\(auth\)/login/page.tsx

sed -i '/{suspended && (/i \
          {isKicked && (\
            <div className="mb-6 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-3.5 text-sm">\
              <p className="font-semibold text-yellow-600 dark:text-yellow-500 mb-1">账号已登出</p>\
              <p className="text-muted-foreground leading-relaxed">\
                您的账号已在其他设备登录。如果这不是您本人的操作，请修改密码。\
              </p>\
            </div>\
          )}\
' /root/autodl-tmp/aigc-test/apps/web/src/app/\(auth\)/login/page.tsx
