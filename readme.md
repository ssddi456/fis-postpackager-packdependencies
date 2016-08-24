# fis-postpackager-packdependencies

用于自动打包页面零散资源和应用打包资源的[FIS](https://github.com/fex-team/fis/)插件

## 功能

 - 自动将指定文件及其依赖合并成package
 - 按类型打包，同名依赖的文件会被
 - 

## 用法

    $ npm install -g fis-postpackager-packdependencies
    $ vi path/to/project/fis-conf.js #编辑项目配置文件

```javascript
//file : path/to/project/fis-conf.js
//使用packdependencies插件，自动应用pack的资源引用
fis.config.set('modules.postpackager', 'packdependencies');
//手动指定需要打包的入口文件
fis.config.set('settings.postpackager.packdependencies', {
   entrances : [
      //
      //  your entrances goes here
      // "file path relative to project root" 
      // or
      // { 
      //   file : "file path relative to project root", 
      //   // 是否打包同名依赖的文件，默认为真
      //   pack_siblings : boolean /* default to true */ 
      // }
      //
   ]
});
```

## 自动打包处理策略

## 配置项

### entrances

需要将其依赖一起打包的文件

### output

合成文件输出路径，默认值 "pkg/packdependencies_${hash}"


## 适应范围

用于减少创建bundle时写的一堆配置.

为了减少文件合并顺序导致的麻烦，请正确的配置```fis-postprocesser-jswraper```, 推荐```type:"amd"```，让加载器为你解决问题。
