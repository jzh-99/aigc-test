本文列举您调用火山方舟 API 可能会涉及的错误码信息，包含方舟错误码和公共错误码。

<span id=".5qih5Z6LLeaZuuiDveS9k-iwg-eUqC1hcGkt5YWs5YWx6ZSZ6K-v56CB"></span>
# 推理错误码


<span aceTableMode="list" aceTableWidth="2,2,3,4,4"></span>
|HTTP<br><br>状态码 |错误类型<br><br>Type |错误码<br><br>Code |错误信息<br><br>Message |含义 |
|---|---|---|---|---|
|400 |BadRequest |MissingParameter |The request failed because it is missing one or multiple required parameters. Request ID: {{id}} |请求缺少必要参数，请查阅 API 文档。 |
|400 |BadRequest |InvalidParameter |One or more parameters specified in the request are not valid. Request ID: {{id}} |请求包含非法参数，请查阅 API 文档。 |
|400 |BadRequest |InvalidParameter |The parameter `instructions` specified in the request are not valid: caching is not supported for instructions. Request id: {{id}} |Responses API 中，当配置过 **instructions** 字段信息，后续轮次无法配置 **Caching** 字段。 |
|400 |BadRequest |InvalidEndpoint.ClosedEndpoint |The request targeted an endpoint that is currently closed or temporarily unavailable. Request ID: {{id}} |推理接入点处于已被关闭或暂时不可用， 请稍后重试，或联系推理接入点管理员。 |
|400 |BadRequest |SensitiveContentDetected |The request failed because the input text may contain sensitive information. |输入文本可能包含敏感信息，请您使用其他 prompt。 |
|400 |BadRequest |SensitiveContentDetected.SevereViolation |The request failed because the input text may contain severe violation information. |输入文本可能包含严重违规相关信息，请您使用其他 prompt |
|400 |BadRequest |SensitiveContentDetected.Violence |The request failed because the input text may contain violence information. |输入文本可能包含激进行为相关信息，请您使用其他 prompt |
|400 |BadRequest |InputTextSensitiveContentDetected |The request failed because the input text may contain sensitive information.Request ID: {{id}} |输入文本可能包含敏感信息，请您更换后重试。 |
|400 |BadRequest |InputImageSensitiveContentDetected |The request failed because the input image may contain sensitive information.Request ID: {{id}} |输入图像可能包含敏感信息，请您更换后重试。 |
|400 |BadRequest |InputVideoSensitiveContentDetected |The request failed because the input video may contain sensitive information. |输入视频可能包含敏感信息，请您更换后重试。 |
|400 |BadRequest |InputAudioSensitiveContentDetected |The request failed because the input audio may contain sensitive information.Request ID: {{id}} |输入音频可能包含敏感信息，请您更换后重试 |
|400 |BadRequest |OutputTextSensitiveContentDetected |The request failed because the output may contain sensitive information. |生成的文字可能包含敏感信息，请您更换输入内容后重试 |
|400 |BadRequest |OutputImageSensitiveContentDetected |The request failed because the output image may contain sensitive information. |生成的图像可能包含敏感信息，请您更换输入内容后重试。 |
|400 |BadRequest |OutputVideoSensitiveContentDetected |The request failed because the output video may contain sensitive information.Request ID: {{id}} |生成的视频可能包含敏感信息，请您更换输入内容后重试。 |
|400 |BadRequest |OutputAudioSensitiveContentDetected |The request failed because the output audio may contain sensitive information.Request ID: {{id}} |生成的音频可能包含敏感信息，请您更换输入内容后重试。 |
|400 |BadRequest |InputTextSensitiveContentDetected.PolicyViolation |The request failed because the input text may be related to copyright restrictions. Request ID: {{id}} |输入文本可能涉及版权限制，请您更换后重试。 |
|400 |BadRequest |InputImageSensitiveContentDetected.PolicyViolation |The request failed because the input image may be related to copyright restrictions. Request ID: {{id}} |输入图片可能涉及版权限制，请您更换后重试。 |
|400 |BadRequest |InputVideoSensitiveContentDetected.PolicyViolation |The request failed because the input video may be related to copyright restrictions. Request ID: {{id}} |输入视频可能涉及版权限制，请您更换后重试。 |
|400 |BadRequest |InputAudioSensitiveContentDetected.PolicyViolation |The request failed because the input audio may be related to copyright restrictions. Request ID: {{id}} |输入音频可能涉及版权限制，请您更换后重试。 |
|400 |BadRequest |OutputVideoSensitiveContentDetected.PolicyViolation |The request failed because the output video may be related to copyright restrictions. Request ID: {{id}} |生成的视频可能涉及版权限制，请您更换输入内容后重试。 |
|400 |BadRequest |InputImageSensitiveContentDetected.PrivacyInformation |The request failed because the input image may contain real person.Request ID: {{id}} |输入图片可能包含真人，请您更换后重试。 |
|400 |BadRequest |InputVideoSensitiveContentDetected.PrivacyInformation |The request failed because the input video may contain real person.Request ID: {{id}} |输入视频可能包含真人，请您更换后重试。 |
|400 |BadRequest |InputTextRiskDetection |The request could not be processed because the input text includes sensitive content that violates ContentSecurityDetection.ARKRequest ID:{{id}};CSDRequestId:{{RequestId}};Label:{{Label}};SubLabel:{{SubLabel}} |火山引擎风险识别产品检测到输入文本可能包含敏感信息，请您更换后重试。 |
|400 |BadRequest |InputImageRiskDetection |The request could not be processed because the input image includes sensitive content that violates ContentSecurityDetection.ARKRequest ID:{{id}};CSDRequestId:{{RequestId}};Label:{{Label}};SubLabel:{{SubLabel}} |火山引擎风险识别产品检测到输入图片可能包含敏感信息，请您更换后重试。 |
|400 |BadRequest |OutputTextRiskDetection |The request could not be processed because the output text includes sensitive content that violates ContentSecurityDetection.ARKRequest ID:{{id}};CSDRequestId:{{RequestId}};Label:{{Label}};SubLabel:{{SubLabel}} |火山引擎风险识别产品检测到输出文本可能包含敏感信息，请您更换后重试。 |
|400 |BadRequest |OutputImageRiskDetection |The request could not be processed because the output image includes sensitive content that violates ContentSecurityDetection.ARKRequest ID:{{id}};CSDRequestId:{{RequestId}};Label:{{Label}};SubLabel:{{SubLabel}} |火山引擎风险识别产品检测到输出图片可能包含敏感信息，请您更换后重试。 |
|400 |BadRequest |ContentSecurityDetectionError |Internal error.ARKRequest ID:{{id}};CSDRequestId:{{RequestId}};CSDcode:{};CSDmessage:{} |火山引擎风险识别产品请求失败。 |
|400 |BadRequest |InvalidParameter.{{Parameter}} |The specified parameter {{Parameter}} is invalid. |请求参数值不合法。请检查参数值的正确性后重试。 |
|400 |BadRequest |MissingParameter.{{Parameter}} |The required parameter {{Parameter}} is missing. |缺少必要的请求参数。请确认请求参数后重试。 |
|400 |BadRequest |Duplicate.Tags.Key |The specified object of tags contains duplicate keys. |对象的标签存在重复Key。 |
|400 |BadRequest |InvalidArgumentError |MissingRole：Invalid message: {{Message}} |请求中的 messages 列表里，有消息体缺少 role 字段 |
|400 |BadRequest |InvalidArgumentError.UnknownRole |Unknown the role of message: {{Role}} |消息体中的 role 值不被支持，如`user_`。 |
|400 |BadRequest |InvalidArgumentError.UnknownRole |The Inference role not found: {{Role}} |指定的 inference_role 未在配置中定义。 |
|400 |BadRequest |InvalidArgumentError.InvalidImageDetail |Invalid image detail: {{Parameter}} |image_url 中的 detail 参数值无效，只接受 "auto", "high", "low" |
|400 |BadRequest |InvalidArgumentError.InvalidPixelLimit |Customized min_pixels 100 is greater than max_pixels 50 |用户自定义的图片像素限制（min_pixels, max_pixels）无效（例如 min_pixels \> max_pixels，或超出了服务配置的范围） |
|400 |BadRequest |InvalidImageURL.EmptyURL |Empty base64 image url |传入的图片 URL 为空 |
|400 |BadRequest |InvalidImageURL.InvalidFormat |Invalid base64 image url |无法解析或处理图片，可能是 Base64 格式不正确、图片数据损坏或格式不支持 |
|400 |BadRequest |OutofContextError |Total tokens of image and text exceed max message tokens. |当请求中包含图片时，文本和图片编码后的总 token 数超过了模型上下文长度限制 |
|400 |BadRequest |InvalidParameter.UnsupportedParameter |The parameters {{Parameter}} specified in the request are not supported by this endpoint. |传入的参数 {{Parameter}} 在此推理接入点不可用。 |
|400 |BadRequest |InvalidParameter.TosURLInvalid |TOS URI invalid. url:%s. |TOS URI不合法。 |
|400 |BadRequest |InvalidParameter |The given Lean code is not compilable under Lean version %s |输入的不是一个合法的Lean Code。 |
|400 |BadRequest |InvalidParameter |The format of the given lean code is not supported so far. |输入的Lean code格式暂不支持。 |
|400 |BadRequest |InvalidParameter |/ |输入的Lean code必须包含theorem |
|400 |Forbidden |InvalidSubscription |Your account ({{account_identifier}}) does not have a valid coding plan subscription, or your subscription has expired. Please visit {{subscription_check_url}} to review your subscription status or complete the subscription or renewal process. |Coding Plan 套餐未订阅或已过期。 |
|401 |Unauthorized |AuthenticationError |The API key or AK/SK in the request is missing or invalid. Request ID: {{id}} |请求携带的 API Key 或 AK/SK 校验未通过，请您重新检查设置的 鉴权凭证，或者查看 API 调用文档来排查问题。 |
|401 |Forbidden |InvalidAccountStatus |There is an issue with your account status. If you need assistance, please contact the platform administrators. |当前使用的账号异常。 |
|403 |Forbidden |OperationDenied.InvalidState |The specified context is in invalid state: InProgress.Request ID: {{id}} |请求所关联的Context ID处于非空闲状态，不可调用。 |
|403 |Forbidden |OperationDenied.ConflictedValidationSet |Operation is denied because it is not supported to configure ValidationSet and ValidationPercentage at the same time. |无法同时上传验证集和设置训练集取样为验证集百分比，不支持该操作。 |
|403 |Forbidden |OperationDenied.PermissionDenied |Operation is denied because you are not permitted to access the specified configuration of the FoundationModel. |您没有权限访问基础模型的配置，不支持该操作。 |
|403 |Forbidden |OperationDenied.UnsupportedCustomizationType |Operation is denied because the specified CustomizationType is not supported by the CustomModel. |模型不支持该训练方法，不支持该操作。 |
|403 |Forbidden |OperationDenied.CustomizationNotSupported |Operation is denied because the specified version of the FoundationModel is not configured for the specified type of customization. |基础模型的版本不支持该训练方法，不支持该操作。 |
|403 |Forbidden |OperationDenied.ServiceNotOpen |Operation is denied because the model service is unavailable, please go to the Volcano Ark console activation management page to activate the corresponding model service, or submit a work order to contact us. |模型服务不可用，不支持该操作。请前往火山方舟控制台激活模型服务，或提交工单联系我们。 |
|403 |Forbidden |OperationDenied.ServiceOverdue |Operation is denied because your account balance is overdue, please go to the Volc Trading Center to recharge in order to continue using the service. |您的账单已逾期，不支持该操作。请前往火山费用中心充值。 |
|403 |Forbidden |AccountOverdueError |The request failed because your account has an overdue balance. Request ID: {{id}} |当前账号欠费（余额<0），如需继续调用，请前往 [火山引擎费用中心](https://console.volcengine.com/finance/fund/recharge) 进行充值，详细操作参见 [充值操作指引](https://www.volcengine.com/docs/6269/100434)。 |
|403 |Forbidden |AccessDenied |The request failed because you do not have access to the requested resource. Request ID: {{id}} |没有访问该资源的权限，请检查权限设置，或联系管理员添加白名单。 |
|403 |Forbidden |OperationDenied.InvalidState |Operation is denied because the specified context is in invalid state: InProgress. Request id: {{id}} |请求的缓存信息状态是不可用状态。请查看缓存信息是否正在被更新中。 |
|403 |Forbidden |OperationDenied.UnsupportedPhase |Operation is denied because operation is not supported while the target is in its current phase. |操作失败，操作目标在特殊状态，请检查目标是否存在或者被锁定等特殊状态中。 |
|403 |Forbidden |OperationDenied.FileQuotaExceeded |Your account %s has exhausted its file storage quota. To continue using the service, please delete historical files. |当前账号 %s 已耗尽文件存储额度，如需继续使用，请删除历史文件。 |
|403 |Forbidden |OperationDenied.ArkAccessRoleNotFound |Please go to Ark Project Settings → Project Authorization, and grant permission to the TOS resource before trying again. |请到方舟项目配置\-项目授权，对tos资源授权后再进行操作。 |
|403 |Forbidden |OperationDenied.TosAccessDenied |Access denied for TOS resource %s. TOS responded: %s. Please verify your account / project has permission to access the specified bucket. |无权访问 TOS 资源，请确认您的账户 / 项目对该 bucket 拥有访问权限。 |
|403 |Forbidden |OperationDenied.InvalidState |The specified file is in invalid state: InProgress.Request ID: {{id}} |请求所关联的File ID处于非可用状态，不可调用。 |
|404 |NotFound |InvalidEndpointOrModel.NotFound |The model or endpoint %s does not exist or you do not have access to it. |模型或者推理接入点 %s 不存在或者您无权访问它。 |
|404 |NotFound |ModelNotOpen |Your account %s has not activated the model %s. Please activate the model service in the Ark Console. |当前账号 %s 暂未开通 %s 模型服务，请前往火山方舟控制台开通管理页开通对应模型服务。 |
|404 |NotFound |NotFound.{{Parameter}} |The specified {{ResourceType}} {{ResourceContent}} is not found. |指定资源找不到。请确认参数后重试。 |
|404 |NotFound |InvalidEndpointOrModel.ModelIDAccessDisabled |Accessing the model via Model ID is not allowed for your account. Please use a custom endpoint ID instead. Request id:{{id}} |未能找到指定的模型ID。你的账号不允许使用模型ID来调用模型，请确认你账号权限或者使用有权限的推理接入点 ID 来调用模型服务。 |
|404 |NotFound |UnsupportedModel |The {{model_name}} model does not support the coding plan feature. Please refer to the documentation at {{doc_url}} to select a compatible model. |当前模型不支持 Coding Plan。 |
|429 |TooManyRequests |RateLimitExceeded.EndpointRPMExceeded |The Requests Per Minute (RPM) limit of the associated endpoint for your account has been exceeded. Request ID: {{id}} |请求所关联的推理接入点已超过 RPM (Requests Per Minute) 限制, 请稍后重试。 |
|429 |TooManyRequests |RateLimitExceeded.EndpointTPMExceeded |The Tokens Per Minute (TPM) limit of the associated endpoint for your account has been exceeded. Request ID: {{id}} |请求所关联的推理接入点已超过 TPM (Tokens Per Minute) 限制, 请稍后重试。 |
|429 |TooManyRequests |ModelAccountRpmRateLimitExceeded |RPM (Requests Per Minute) limit of the model is exceeded. Request ID: {{id}} |请求已超过帐户模型 RPM (Requests Per Minute) 限制: 请您稍后重试, 或者联系平台技术同学进行解决 |
|429 |TooManyRequests |ModelAccountTpmRateLimitExceeded |TPM (Tokens Per Minute) limit of the model is exceeded. Request ID: {{id}} |请求已超过帐户模型 TPM (Tokens Per Minute) 限制: 请您稍后重试, 或者联系平台技术同学进行解决 |
|429 |TooManyRequests |APIAccountRpmRateLimitExceeded |The RPM (Requests Per Minute) limit for the API on your account has been exceeded. Request ID: {{id}} |当前账号该接口的RPM (Requests Per Minute)限制已超出，请稍后重试。 |
|429 |TooManyRequests |ModelAccountIpmRateLimitExceeded |IPM (Images Per Minute) limit of the model is exceeded. |请求已超过账户模型 IPM (Images Per Minute) 限制: 请您稍后重试, 或者联系平台技术同学进行解决 |
|429 |TooManyRequests |QuotaExceeded |Your account [%s] has exhausted its free trial quota for the [%s] model. Request ID: {{id}} |当前账号 %s 对 %s 模型的免费试用额度已消耗完毕，如需继续调用，请前往火山方舟控制台开通管理页开通对应模型服务。 |
|429 |TooManyRequests |QuotaExceeded |The request has exceeded the quota. Request ID: {{id}} |当前账号处于排队中状态的任务数已超过限制，请稍后重试。 |
|429 |TooManyRequests |ServerOverloaded |The service is currently unable to handle additional requests due to server overload. Please retry later. Request ID: {{id}} |服务资源紧张，请您稍后重试。常出现在调用流量突增或刚开始调用长时间未使用的推理接入点。<br><br><div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div><br><br><br><div data-tips="true" data-tips-type="tip">调用<code>doubao-seed-1.8</code>及之前版本模型触发突增流量限制时，返回此错误码。可参考<a href="https://www.volcengine.com/docs/82379/1848593">突发流量处理最佳实践</a>处理。</div><br> |
|429 |TooManyRequests |RequestBurstTooFast |System protection triggered by request burst. Please slow down traffic growth and increase requests gradually before retrying. |请求量激增触发系统保护，请放缓流量提升速度，逐步增加请求量后再尝试<br><br><div data-tips="true" data-tips-type="tip" data-tips-is-title="true">说明</div><br><br><br><div data-tips="true" data-tips-type="tip">调用 <code>doubao-seed-2.0</code>及之后版本模型触发突增流量限制时，返回此错误码，可参考<a href="https://www.volcengine.com/docs/82379/1848593">突发流量处理最佳实践</a>处理。</div><br> |
|429 |TooManyRequests |SetLimitExceeded |Your account [%s] has reached the set inference limit for the [%s] model, and the model service has been paused. To continue using this model, please visit the Model Activation page to adjust or close the "Safe Experience Mode".<br><br>Request ID: {{id}} |当前账号 %s 对 %s 模型已达到设置的推理限额值，如需继续调用，请前往火山方舟控制台开通管理页修改限额值或关闭安心体验模式。 |
|429 |TooManyRequests |InflightBatchsizeExceeded |The Inflight Batchsize limit has been exceeded.Request ID: {{id}} |您已经达到当前充值金额下的最大并发数限制，您可以充值解锁更大并发额度或降低并发数。 |
|429 |TooManyRequests |AccountRateLimitExceeded |Requests are too frequent. Please reduce your request frequency, wait a short moment, and retry your request. |请求超出RPM / TPM限制。 |
|429 |TooManyRequests |QuotaExceeded |You have exceeded the 5\-hour/weekly/monthly usage quota. It will reset at {{reset_time}}. |使用的额度超出5小时/周/月限额。 |
|500 |InternalServerError |InternalServiceError |The service encountered an unexpected internal error. Please retry later. Request ID: {{id}} |内部系统异常，请您稍后重试。 |


<span id="9b1548df"></span>
# 精调错误码

本部分将介绍模型精调相关的错误码信息及其建议的解决方案。


<span aceTableMode="list" aceTableWidth="2,2,3"></span>
|错误码 |示例错误信息 |说明与建议解决方案 |
|---|---|---|
|InvalidData.MissingKey |Data format is not expected:column not found |数据格式不符合预期, 未找到名为的列, 建议检查并补全数据集中相应键值. |
|InvalidData.UnknownKey |Wrong Key, parsing sample failed |数据中有错误的Key, 解析样本失败, 建议检查错误信息中对应样本的键值 |
|InvalidData.InvalidValue |Unsupported data type:, only pretrain, dialog, dialog\-dpo and multimodal supported |不支持的数据集类型, 仅支持"pretrain", "dialog", "dialog\-dpo", 和"multimodal"类型, 建议检查填入的数据集类型 |
||Content is empty, original text content is: |content字段内容为空, 原文本内容为, 建议检查原文本的数据完整性. |
|InvalidData.InvalidJsonl |not supported |数据集文件格式不支持, 建议调整对应文件为`.jsonl`格式. |
||No jsonl file available |无可用的jsonl文件, 建议检查数据集包含的文件列表. |
|InvalidData.InvalidJson |Expecting value: line 1 column 1 (char 0) in fileatrow |在<文件名\>中第行, JSON解析失败, 建议检查数据集文件内容是否符合JSON规范. |
|InvalidData |failed to init data preprocess builder: training tos bucket: maas\-data\-test, tos path:<br><br>: tos objects do not exist |提供的数据集地址在TOS中不存在, 建议检查TOS中数据集文件是否出现缺失或地址错误. |
|UnknownError |service error occur, please contact customer service for help |平台服务错误, 不可重试, 建议发起工单协助排查 |
|InternalError |task failed, please check the logs |训练失败, 建议检查日志后发起重试, 如仍无法解决问题, 建议发起工单协助排查. |


<span id="d674f4be"></span>
# 公共错误码

查询火山引擎的[公共错误码](https://www.volcengine.com/docs/6369/68677)。



