# Toby 业务管理平台接口文档（Markdown 版）

> - **来源**：`docs/open-api/Toby业务管理平台-接口文档.pdf`（人工转换并修正 PDF 重叠字符渲染瑕疵）
> - **转换日期**：2026-06-29
> - **协议层封装**：`apps/api/src/lib/toby-open-api.ts`（DES/CBC/PKCS5Padding 加解密 + MD5 签名）
> - **服务编码常量**：`TOBY_SERVICE_CODES`（`apps/api/src/lib/toby-open-api.ts`）
> - **说明**：所有接口均为 POST + JSON，请求体 `{ appID, requestJson }`，`requestJson` 为加密后的业务参数；响应 `data` 为 `{ appID, responseJson }`，`responseJson` 解密后含业务字段 + 验签字段（`appID/timestamp/serviceCode/signature`）。

## 通用约定

### 签名规则

- 签名值 = 对 `appID/appSecret/timestamp/serviceCode` 按 key 排序后拼接（`key=value&...`）做 MD5。
- `timestamp` 为秒级时间戳，参与签名。
- 签名有效期：默认 600 秒（`TOBY_SIGNATURE_VALID_SECONDS` 环境变量可调）。

### 加解密

- 算法：DES/CBC/PKCS5Padding
- IV：固定 `12345678`
- 密钥：取 `TOBY_OUTBOUND_PRIVATE_KEY`（出站）/ `TOBY_INBOUND_PRIVATE_KEY`（入站）前 8 字节

### 服务编码（serviceCode）

| 常量名 | serviceCode | 接口 |
|---|---|---|
| memberLoginInfo | MEMBER-1001 | 会员信息查询 |
| memberSubCard | MEMBER-1002 | 会员副卡变动同步 |
| memberRegister | MEMBER-1003 | 个人会员注册 |
| memberPoints | MEMBER-1004 | 会员 A 豆余额查询 |
| pointsChangeQuery | AIHUB_POINTS_CHANGE_QUERY | A 豆流水查询 |
| pointsChange | AIHUB_POINTS_CHANGE | A 豆扣减 |
| creationResultNotify | AIHUB_CREATION_RESULT_NOTIFY | 创作结果同步 |
| subscribe | SUBSCRIBE_SERVICE_CODE_1001 | 订购同步 |
| specificationConfig | SPECIFICATION-CONFIG | 模型规格同步 |

---

## 1. 会员信息查询接口

### 1.1 接口定义

- **接口名称**：会员信息查询
- **接口描述**：根据手机号查询会员信息，同一手机号可能关联多条会员记录，返回会员信息列表；未查询到会员时返回会员不存在。
- **承载协议**：HTTPS
- **请求方式**：POST
- **数据格式**：JSON
- **测试 URL**：`http://61.155.229.73:18080/api/toby/member/query-by-phone`

### 1.2 请求参数（requestJson 解密后）

| 参数名称 | 类型 | 说明 | 是否必填 |
|---|---|---|---|
| timestamp | String | 秒级时间戳；参与签名 | 是 |
| signature | String | 签名参数 | 是 |
| serviceCode | String | 服务编码，固定为 `MEMBER-1001` | 是 |
| phone | String | 手机号 | 是 |

### 1.3 响应参数

外层：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| code | String | `0000` 成功；`1000` 参数/验签/业务规则异常；`1001` 会员不存在；`9999` 系统异常 |
| message | String | 响应描述 |
| data | Object | 成功时为 `{ appID, responseJson }` |

responseJson 解密后：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| appID | String | 应用标识 |
| serviceCode | String | 接口编码 |
| timestamp | String | 秒级时间戳 |
| signature | String | 签名参数 |
| members | Array | 会员信息列表 |
| members[].userId | String | 会员编号 |
| members[].phone | String | 手机号 |
| members[].userName | String | 会员名称 |
| members[].compName | String | 公司名称（个人会员为空；仅公司会员有值） |
| members[].userType | String | 会员类型：1-个人，2-公司 |
| members[].status | Integer | 当前状态：1-正常，2-冻结，3-删除 |
| members[].pointsNum | BigDecimal | A 豆余额；为空时按 0 返回 |
| members[].sumPointsNum | BigDecimal | 累计获得 A 豆；为空时按 0 返回 |
| members[].consumePointsNum | BigDecimal | 累计消耗 A 豆；为空时按 0 返回（过期不统计） |
| members[].goodsId | String | 最近一条已完成订购记录的商品 ID |
| members[].goodsName | String | 最近一条已完成订购记录的商品名称 |
| members[].createTime | Date | 注册时间 |

成功结果示例：

```json
{
  "members": [
    {
      "userId": "8f3d...",
      "phone": "13800000000",
      "userName": "张三",
      "compName": "个人",
      "userType": "1",
      "status": 1,
      "pointsNum": 0.00,
      "sumPointsNum": 100.00,
      "consumePointsNum": 10.22,
      "goodsId": "goods001",
      "goodsName": "模型规格名称",
      "createTime": "2026-06-21 10:00:00"
    }
  ]
}
```

---

## 2. A 豆流水查询接口

> **本项目使用入口**：服务层 `queryCurrentBizMgmtLedger`（`apps/api/src/services/biz-mgmt-a-bean.ts`）→ 协议层 `queryTobyPointsChangeList`。

### 2.1 接口定义

- **接口名称**：A 豆流水查询
- **接口描述**：查询 A 豆变动流水，包含订购、创作、返还等场景的增加/扣减记录
- **承载协议**：HTTPS
- **请求方式**：POST
- **数据格式**：JSON
- **测试 URL**：`http://61.155.229.73:18080/api/toby/points/external/change-list`

### 2.2 请求参数（requestJson 解密后）

| 参数名称 | 类型 | 说明 | 是否必填 |
|---|---|---|---|
| timestamp | String | 秒级时间戳 | 是 |
| signature | String | 签名参数 | 是 |
| serviceCode | String | `AIHUB_POINTS_CHANGE_QUERY` | 是 |
| userId | String | 会员编号，用户唯一标识 | 是 |
| changeType | String | 变动类型：1 扣减；2 返还；3 赠送；4 过期；5 充值（支持逗号分割） | 否，为空表示查询全部流水（不分类） |
| pageNum | Integer | 页码，必须大于 0 | 是 |
| pageSize | Integer | 每页条数，必须大于 0 且不大于 100 | 是 |

### 2.3 响应参数

外层：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| code | String | `0000` 成功 |
| message | String | 信息描述 |
| data | String | JSON 字符串 `{ appID, responseJson }` |

responseJson 解密后：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| timestamp | String | 秒级时间戳 |
| signature | String | 签名参数 |
| serviceCode | String | 接口编码 |
| appID | String | 应用标识 |
| total | long | 总条数 |
| pageNum | int | 页码 |
| pageSize | int | 页大小 |
| records | JSONObject | 流水列表（文档标 JSONObject，配合 total/pageNum 实际形态可能是数组或对象，本项目 normalizeTobyRecords 双形态归一化） |
| records[].changeNo | String | 流水号 |
| records[].userId | String | 会员编号，用户唯一标识 |
| records[].changeType | Integer | 变动类型：1 扣减；2 返还；3 赠送；4 过期；5 充值，支持逗号分割 |
| records[].changeTypeName | String | 类型对应描述 |
| records[].changePointsNum | BigDecimal | 变动数 |
| records[].balancePointsNum | BigDecimal | 变动后 A 豆余额 |
| records[].bizNo | String | 关联业务单号（创作单号、订购单号等） |
| records[].changeReason | String | 变动原因 |
| records[].source | String | 来源渠道：1 B 端；2 C 端；3 H 端；4 业务管理平台 |
| records[].operateUser | String | 操作人 |
| records[].remark | String | 备注 |
| records[].createTime | Date | `yyyy-MM-dd HH:mm:ss`（无时区，业管本地时间） |

> **本项目映射说明**：`apps/api/src/services/biz-mgmt-a-bean.ts` 的 `mapTobyPointsChangeRecord` 把 `changeType 1-5` 映射为中性枚举 `deduct/refund/gift/expire/recharge`，`amount` 按 sign 取正负（扣减/过期为负）；未知 changeType 兜底为 `unknown` + 保守取正。`records` 经 `normalizeTobyRecords` 归一化（数组/对象双形态）。`createTime` 原样透传（无时区，前端 `new Date()` 按本地时区渲染，避免转 ISO 导致偏移）。

---

## 3. A 豆扣减接口

### 3.1 接口定义

- **接口名称**：A 豆扣减
- **接口描述**：A 豆的所有扣减情况，同步给到业务管理平台
- **承载协议**：HTTPS
- **请求方式**：POST
- **测试 URL**：`http://61.155.229.73:18080/api/toby/points/external/change`

### 3.2 请求参数（requestJson 解密后）

| 参数名称 | 类型 | 说明 | 是否必填 |
|---|---|---|---|
| timestamp | String | 秒级时间戳 | 是 |
| signature | String | 签名参数 | 是 |
| serviceCode | String | `AIHUB_POINTS_CHANGE` | 是 |
| userId | String | 会员编号，用户唯一标识 | 是 |
| requestNo | String | 请求号，不能为空 | 是 |
| source | Integer | 1 B 端；2 C 端；3 H 端；4 业务管理平台 | 是 |
| workNo | String | 创作单号 | 是 |
| pointsNum | BigDecimal | 扣减数 | 是 |
| remark | String | 备注 | 否 |

### 3.3 响应参数

responseJson 解密后：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| timestamp | String | 秒级时间戳 |
| signature | String | 签名参数 |
| serviceCode | String | 接口编码 |
| appID | String | 应用标识 |
| requestNo | String | 请求号 |
| workNo | String | 创作单号 |
| status | String | `DEDUCTED` 已扣减 |
| balancePointsNum | BigDecimal | 变动后余额 |
| idempotent | Boolean | 是否幂等返回，true 表示本次直接返回历史处理结果 |

---

## 4. 创作结果同步接口

### 4.1 接口定义

- **接口名称**：创作结果同步
- **接口描述**：会员在应用页面进行创作的结果，从 AI 中台收到结果后同步给到业务管理平台
- **承载协议**：HTTP
- **请求方式**：POST
- **测试 URL**：`http://61.155.229.73:18080/api/toby/points/external/result-notify`

### 4.2 请求参数（requestJson 解密后）

| 参数名称 | 类型 | 说明 | 是否必填 |
|---|---|---|---|
| timestamp | String | 秒级时间戳 | 是 |
| signature | String | 签名参数 | 是 |
| serviceCode | String | `AIHUB_CREATION_RESULT_NOTIFY` | 是 |
| userId | String | 会员编号，用户唯一标识 | 是 |
| requestNo | String | 请求号，不能为空 | 是 |
| workNo | String | 创作单号 | 是 |
| success | Boolean | 创作结果：true 成功；false 失败 | 是 |
| remark | String | 备注 | 否 |

### 4.3 响应参数

responseJson 解密后：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| timestamp | String | 秒级时间戳 |
| signature | String | 签名参数 |
| serviceCode | String | 接口编码 |
| appID | String | 应用标识 |
| requestNo | String | 流水号 |
| workNo | String | 创作单号 |
| status | String | `DEDUCTED` 已扣减；`SUCCESS` 已成功；`REFUNDED` 已返还 |
| balancePointsNum | BigDecimal | 变动后余额 |
| idempotent | Boolean | 是否幂等返回 |

---

## 5. 订购同步接口

### 5.1 接口定义

- **接口名称**：订购同步接口
- **接口描述**：用户在应用端完成订购/领取权益后，同步订购关系至业管
- **承载协议**：HTTPS
- **请求方式**：POST
- **测试 URL**：`http://61.155.229.73:18080/api/toby/subscribe/external/dealExSubscribe`

### 5.2 请求参数（requestJson 解密后）

| 参数名称 | 类型 | 说明 | 是否必填 |
|---|---|---|---|
| timestamp | String | 秒级时间戳 | 是 |
| signature | String | 签名参数 | 是 |
| serviceCode | String | 接口编码 | 是 |
| requestNo | String | 请求号，不能为空 | 是 |
| exOrderNo | String | 唯一幂等订单号 | 是 |
| phone | String | 手机号码 | 是 |
| channel | Integer | 用户注册渠道：1 B 端；2 C 端；3 H 端 | 是 |
| source | String | 订购来源渠道（4 位大写字符，例如 权益中心 `QYZX`、本地权益 `BDQY`） | 是 |
| goodsId | String | 商品 id | 是 |
| orderType | Integer | 订单类型：1 订购；2 续订；3 退订 | 是 |
| payAmount | BigDecimal | 实付金额（2 位小数） | 是 |
| status | Integer | 状态：1 已完成；2 处理中；3 已退订；4 已取消 | 是 |
| orderTime | String | 下单时间 | 否 |

### 5.3 响应参数

外层 code：`0000` 处理成功；`9999` 系统异常；`1000` 参数异常。

responseJson 解密后：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| timestamp | String | 秒级时间戳 |
| signature | String | 签名参数 |
| serviceCode | String | 接口编码 |
| appID | String | 应用标识 |
| requestNo | String | 流水号 |
| exOrderNo | String | 唯一订单号 |
| orderNo | String | toby 订单号 |

---

## 6. 会员副卡变动同步接口

### 6.1 接口定义

- **接口名称**：会员副卡变动同步
- **接口描述**：创建会员副卡并初始化 A 豆；副卡按公司会员创建，需关联归属用户
- **承载协议**：HTTPS
- **请求方式**：POST
- **测试 URL**：`/api/toby/member/sub-card`

> **2026-06-29 契约更新**：请求参数移除 `compName`（公司名称）与 `channel`（用户渠道）。
> 副卡所属公司由 `belongId` 在业管侧解析，渠道固定为 B 端无需再传。

### 6.2 请求参数（requestJson 解密后）

| 参数名称 | 类型 | 说明 | 是否必填 |
|---|---|---|---|
| timestamp | String | 秒级时间戳；参与签名 | 是 |
| signature | String | 签名参数 | 是 |
| serviceCode | String | 固定为 `MEMBER-1002` | 是 |
| phone | String | 手机号（成员） | 是 |
| userName | String | 会员名称（成员） | 是 |
| belongId | String | 所属管理员的会员编号（必须为已存在可用会员） | 是 |
| initialPointsNum | BigDecimal | 初始 A 豆；不能小于 0 | 是 |

### 6.3 响应参数

外层 code：`0000` 成功；`1000` 参数/验签/业务规则异常；`9999` 系统异常。

responseJson 解密后：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| appID | String | 应用标识 |
| serviceCode | String | 接口编码 |
| timestamp | String | 秒级时间戳 |
| signature | String | 签名参数 |
| userId | String | 管理员名下新建成员的会员编号 |

---

## 7. 模型规格同步接口

### 7.1 接口定义

- **接口名称**：模型规格参数同步接口
- **接口描述**：业务管理平台对模块（包括规格、A 豆价值）进行新增/编辑时，同步模型相关参数数据给应用层系统
- **承载协议**：HTTPS
- **请求方式**：POST
- **测试 URL**：`/api/toby/specification-config`

### 7.2 请求参数（requestJson 解密后）

| 参数名称 | 类型 | 说明 | 是否必填 |
|---|---|---|---|
| timestamp | String | 秒级时间戳；参与签名 | 是 |
| signature | String | 签名参数 | 是 |
| serviceCode | String | 固定为 `SPECIFICATION-CONFIG` | 是 |
| modelParams.modelCode | String | 模型编码 | 是 |
| modelParams.modelType | String | 模型类型（1 图片；2 视频；3 文本） | 是 |
| modelParams.modelName | String | 模型名称 | 是 |
| modelParams.modelDesc | String | 模型描述 | 是 |
| modelParams.modelProvider | String | 模型供应商 | 是 |
| modelParams.useChannel | String | 使用渠道（如 B 端创作平台 `B`、C 端小程序 `C`、H 端中屏 `H`） | 是 |
| modelParams.singleUnit | String | 计量单位（图片 `fix`/每张，视频 `second`/每秒，文本默认 `1`） | 是 |
| modelParams.materialRatio | String | 素材比例（3:4、16:9、自适应，多个则拼接） | 是 |
| modelParams.params | Array | 规格数组 | 是 |
| modelParams.params[].resolutionRatio | String | 规格（如 1k、2k、4k、1080p 等） | 是 |
| modelParams.params[].singleConsumeCount | Integer | A 豆单次消耗数量 | 是 |
| modelParams.params[].inputConsumeCount | Integer | A 豆输入消耗 | 否 |
| modelParams.params[].ouputConsumeCount | Integer | A 豆输出消耗 | 否 |

### 7.3 响应参数

外层 code：`0000` 成功；`1000` 参数/验签/异常；`9999` 系统异常。

responseJson 解密后：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| timestamp | String | 秒级时间戳 |
| signature | String | 签名参数 |
| serviceCode | String | 接口编码 |
| appID | String | 应用标识 |
| requestNo | String | 流水号 |
| status | String | 0 成功；1 失败 |

---

## 8. 个人会员注册接口

### 8.1 接口定义

- **接口名称**：个人会员注册接口
- **接口描述**：仅面向个人会员（userType=1）进行 TobyAI 会员注册，已存在则返回错误；注册成功后返回会员唯一编号。（同手机号仅能注册一个有效个人类型的会员，逻辑删除后可再次注册）
- **承载协议**：HTTPS
- **请求方式**：POST
- **测试 URL**：`/api/toby/member/register`

### 8.2 请求参数（requestJson 解密后）

| 参数名称 | 类型 | 说明 | 是否必填 |
|---|---|---|---|
| timestamp | String | 秒级时间戳；参与签名 | 是 |
| signature | String | 签名参数 | 是 |
| serviceCode | String | 固定为 `MEMBER-1003` | 是 |
| phone | String | 登录手机号 | 是 |
| userName | String | 会员名称（姓名/昵称） | 是 |
| channel | String | 注册渠道：1 B 端；2 C 端；3 H 端 | 是 |

### 8.3 响应参数

外层 code：`0000` 成功；`1000` 参数/验签/异常；`9999` 系统异常。

responseJson 解密后：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| appID | String | 应用标识 |
| serviceCode | String | 接口编码 |
| timestamp | String | 秒级时间戳 |
| signature | String | 签名参数 |
| userId | String | 会员编号 |

---

## 9. 会员 A 豆余额查询接口

### 9.1 接口定义

- **接口名称**：会员 A 豆余额查询接口
- **接口描述**：根据会员编号查询当前账户下的 A 豆余额、累计获得 A 豆
- **承载协议**：HTTPS
- **请求方式**：POST
- **测试 URL**：`/api/toby/member/query-points`

### 9.2 请求参数（requestJson 解密后）

| 参数名称 | 类型 | 说明 | 是否必填 |
|---|---|---|---|
| timestamp | String | 秒级时间戳；参与签名 | 是 |
| signature | String | 签名参数 | 是 |
| serviceCode | String | 固定为 `MEMBER-1004` | 是 |
| userId | String | 会员编号 | 是 |

### 9.3 响应参数

外层 code：`0000` 成功；`1000` 参数/验签/异常；`9999` 系统异常。

responseJson 解密后：

| 参数名称 | 类型 | 说明 |
|---|---|---|
| appID | String | 应用标识 |
| serviceCode | String | 接口编码 |
| timestamp | String | 秒级时间戳 |
| signature | String | 签名参数 |
| pointsNum | BigDecimal | A 豆余额；为空时按 0 返回 |
| sumPointsNum | BigDecimal | 累计获得 A 豆；为空时按 0 返回 |
| status | Integer | 当前状态：1 正常；2 冻结；3 删除 |
