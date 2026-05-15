# collaborable 

1. 实现多 Object 运行机制
2. 实现多 Object 对话机制
3. 多 Object 之间通过 command talk 进行对话
4. talk 会创建 callee 的一个 thread
5. web 界面，用户创建的 session 的初始 thread, 等同于 user 执行了一次 command talk
6. 创建 session 会默认创建 user 的 flow 对象目录, 并初始化 user 的 root thread, 然后以 user 的身份发起与 target object 的 talk command 的执行
7. web 界面需要支持从 user 角度查看他创建的 threads （还是查看 context tree 的那个组件，不需要额外开发，只是需要支持切换当前展示的 thread）