## 错误代码
本指南提供了您在使用Mureka API时可能会遇到的错误代码的概述。

## API 错误
400 - Invalid Request	原因：请求参数不正确。
解决方案：请参考文档以输入正确的请求参数。

401 - Invalid Authentication	原因：认证无效。
解决方案：请确保使用正确的API密钥。

403 - Forbidden	原因：您正在从不支持的地区访问API。
解决方案：请确保您的访问来自支持的地区。

429 - Rate limit reached for requests	原因：您发送请求的速度过快。
解决方案：请控制请求速度，查看价格方案中的并发请求限制。

429 - You exceeded your current quota, please check your billing details	原因：您的充值已用完。
解决方案：请充值。

451 - Unavailable For Legal Reasons	原因：请求参数没有通过安审。
解决方案：请修改请求参数。

500 - The server had an error while processing your request	原因：我们的服务出现了问题。
解决方案：稍后重试您的请求，如果问题仍然存在，请联系我们。

503 - The engine is currently overloaded, please try again later	原因：我们的服务负载过高。
解决方案：请稍后重试您的请求。