# HY-3D 常见错误码

> 完整错误码: https://cloud.tencent.com/document/product/1823/131595

## 速查

| HTTP | Code | 含义 | 处理 |
|------|------|------|------|
| 400 | 400002 | 参数无效/缺失 | 用 `tccli ai3d <Action> help` 检查参数名和格式 |
| 400 | 400004 | 模型不存在 | 检查 Model 参数值 (3.0/3.1) |
| 401 | 401001 | 未认证 | `tccli configure` 检查 secretId/secretKey |
| 401 | 401002 | API Key 无效 | TokenHub: 检查 `HY3D_API_KEY` |
| 402 | 401008 | 免费额度耗尽 | 控制台开启后付费 |
| 429 | 429005 | 并发上限 | 当前任务数超限，等 30s 重试 |
| 429 | 429006 | 上游限流 | 服务繁忙，降频重试 |
| 451 | 451001 | 内容审核不通过 | 调整 prompt 内容 |
| 504 | 504001 | 上游超时 | 重试 |

## 响应格式

```json
{
  "Error": {
    "Code": "InvalidParameterValue.InvalidResultFormat",
    "Message": "ResultFormat为glb不在支持的模型格式列表[OBJ, GLB, STL, FBX, USDZ]内。"
  },
  "RequestId": "xxx"
}
```

注意: CLI 参数名是 PascalCase (`ResultFormat`), 而 TokenHub OpenAI 兼容接口是 snake_case (`result_format`)。
