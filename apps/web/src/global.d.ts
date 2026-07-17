// 声明 CSS 文件模块，允许副作用导入（如 import 'xxx/style.css'）
declare module '*.css' {
  const content: Record<string, string>
  export default content
}
