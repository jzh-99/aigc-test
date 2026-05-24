## code graph
```
# 在项目中初始化（-i 表示交互式）
codegraph init -i


# 非交互式安装（CI 环境）
# 自动检测所有已安装代理，全局安装
codegraph install --yes

# 指定目标代理
codegraph install --target=cursor,claude,codex --yes

# 项目级别安装
codegraph install --target=auto --location=local


# 更新同步
codegraph sync


## 验证安装
codegraph status          # 查看索引状态和统计
codegraph query "UserService"  # 测试符号搜索

参考：https://blog.csdn.net/chendongqi2007/article/details/161292757
```