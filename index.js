/* global fis */

/*
 * fis
 * http://fis.baidu.com/
 */

'use strict';

var stable = require('stable');

var defaultSetting = {
    output: 'pkg/packdependencies_${hash}'
};


function trimQuery(url) {
    if (url.indexOf("?") !== -1) {
        url = url.slice(0, url.indexOf("?"));
    }
    return url;
}


function getResourcePathMap(ret, conf, settings, opt) {
    var map = {};
    fis.util.map(ret.map.res, function (subpath, file) {
        map[trimQuery(file.uri)] = subpath;
    });
    fis.util.map(ret.pkg, function (subpath, file) {
        map[trimQuery(file.getUrl(opt.hash, opt.domain))] = file.getId();
    });
    return map;
}

function getPackMap(ret, conf, settings, opt) {
    var uriToIdMap = {};
    var fileToPack = {};
    var packToFile = {};
    fis.util.map(ret.map.pkg, function (id, pkg) {
        uriToIdMap[pkg.uri] = id;
    });
    fis.util.map(ret.pkg, function (subpath, file) {
        var uri = file.getUrl(opt.hash, opt.domain);
        var id = uriToIdMap[uri];
        if (id) {
            //没有ID的PKG文件无需建立MAP
            packToFile[id] = file;
            fileToPack[file.getId()] = {
                id: id,
                pkg: ret.map.pkg[id]
            };
        }
    });
    return {
        packToFile: packToFile,
        fileToPack: fileToPack
    };
}

/**
 * 将页面依赖的资源与打包资源对比合并
 * @param resources
 * @param ret
 * @param fullPackHit 是否要求资源整体命中打包对象
 * @returns {Array}
 */
function getPkgResource(resources, ret, fullPackHit) {
    var pkgList = {};
    var list = [];
    var handled = {};
    var idList = resources.map(function (resource) {
        return resource.id;
    });
    var resourceMap = {};
    resources.forEach(function (resource) {
        resourceMap[resource.id] = resource;
    });

    function fullPackPass(resource) {
        if (!fullPackHit) {
            return true;
        }
        var pkg = ret.map.pkg[ret.map.res[resource.id].pkg];
        var unHit = pkg.has.filter(function (id) {
            return idList.indexOf(id) == -1;
        });
        return unHit.length === 0;
    }

    function addPkg(id, pkg, srcId) {
        if (pkgList[id])
            return;
        var head = false;
        pkg.has.forEach(function (inPkg) {
            handled[inPkg] = true;
            if (resourceMap[inPkg]) {
                head = head || (resourceMap[inPkg].head || false);
            }
        });
        pkgList[id] = true;
        list.push({
            type: 'pkg',
            id: id,
            srcId: srcId,
            head: head
        });
    }

    resources.forEach(function (resource) {
        var id = resource.id;
        if (handled[id]) {
            return false;
        }
        //当前资源是pack打包后的结果
        if (ret.packMap.fileToPack[id]) {
            var pack = ret.packMap.fileToPack[id];
            addPkg(pack.id, pack.pkg, id);
            return true;
        }
        var res = ret.map.res[id];
        handled[id] = true;
        if (res.pkg && fullPackPass(resource)) {
            addPkg(res.pkg, ret.map.pkg[res.pkg], id);
        }
        else {
            list.push({
                type: 'res',
                id: id,
                single: resource.single,
                head: resource.head
            });
        }
    });
    return list;
}

/**
 * 自动打包零散资源
 * @param resList
 * @param ret
 * @param settings
 * @param conf
 * @param opt
 * @returns {Array}
 */
function autoCombine(resList, ret, conf, settings, opt) {
    var list = [];
    var toCombine = [];
    var fileExt;

    function getCombineHash(list) {
        var idList = list.map(function (res) {
            return res.id;
        });
        return stable(idList).join(',');
    }

    function flushCombine() {
        if (toCombine.length == 1) {
            //单独的文件不进行处理
            list.push(toCombine[0]);
            toCombine = [];
            return;
        }
        if (toCombine.length !== 0) {
            var hash = getCombineHash(toCombine);
            var content = '';
            var index = 0;
            var has = [];
            var id;
            if (combineCache[hash]) {
                fis.log.debug('auto combine hit cache [' + hash + ']');
                id = combineCache[hash];
            }
            else {
                toCombine.forEach(function (res) {
                    var file = ret.ids[res.id];
                    var c = file.getContent();
                    has.push(file.getId());
                    if (!fileExt) {
                        fileExt = file.isJsLike ? 'js' : 'css';
                    }
                    if (c !== '') {
                        if (index++ > 0) {
                            content += '\n';
                            if (file.isJsLike) {
                                content += ';';
                            }
                            else if (file.isCssLike) {
                                c = c.replace(/@charset\s+(?:'[^']*'|"[^"]*"|\S*);?/gi, '');
                            }
                        }
                        content += c;
                    }
                });

                var subpath = settings.output
                                .replace('${hash}', fis.util.md5(stable(has).join(','), 5)) + '.' + fileExt;

                var file = fis.file(fis.project.getProjectPath(), subpath);
                ret.pkg[file.subpath] = file;
                file.setContent(content);
                id = "auto_" + fileExt + "_" + combineCount;
                ret.map.pkg[id] = {
                    uri: file.getUrl(opt.hash, opt.domain),
                    type: fileExt,
                    has: has
                };
                combineCache[hash] = id;
                combineCount++;
            }
            list.push({
                type: 'pkg',
                id: id
            });
            toCombine = [];
        }
    }

    resList.forEach(function (res) {
        if (res.type === 'pkg') {
            flushCombine();
            list.push(res);
        }
        else {
            if (res.single) {
                flushCombine();
                list.push(res);
            }
            else {
                toCombine.push(res);
            }
        }
    });
    flushCombine();
    return list;
}


function getCharset(file) {
    var charset = file ? file.charset : fis.config.get('project.charset');
    switch (charset) {
    case 'utf8':
        return 'utf-8';
    default:
        return charset;
    }
}


function file_deploy_path_check ( ret ) {
    var release_map = {};
    [ret.map.res, ret.map.pkg].forEach(function( map ) {
        fis.util.map(map, function( subpath, info ) {
            if( info.uri ){
                if( release_map[info.uri] != undefined ){
                    throw new Error('release path conflict : \n' 
                                        + release_map[info.uri]  + '\n'
                                        + 'and\n'
                                        + subpath + '\n'
                                        + 'should not publish to the same path ' + info.uri );
                } else {
                    release_map[info.uri] = subpath;
                }
            }
        });
    });
}

module.exports = function (ret, conf, settings, opt) { //打包后处理
    var map = ret.map;

    var src = ret.src;
    var pkg = ret.pkg;

    var res = map.res;

    var mpkg = map.pkg;

    if (opt.pack) {

        settings = fis.util.merge(fis.util.clone(defaultSetting), settings);

        var pathMap = getResourcePathMap(ret, conf, settings, opt);
        ret.packMap = getPackMap(ret, conf, settings, opt);
        // autoCombine模式下，autoReflow必为真
        if (settings.autoCombine) {
            settings.autoReflow = true;
        }

        var entrances = settings.entrances;

        if( !entrances || !entrances.length ){
            fis.log.warning('option entrances must be set');
            return;
        }


        function walk_dep_tree(cur_node, add_to_deps) {
            if(cur_node && cur_node.deps){
                cur_node.deps.forEach(function( dep ) {
                    add_to_deps(dep);
                    walk_dep_tree(res[dep], add_to_deps);
                });
            }
        }

        var project_path = fis.project.getProjectPath();
        entrances.forEach(function( entrance, idx ) {
            var file = fis.file( project_path, entrance );
            if( !file.exists() ){
                fis.log.warning('entrance file : ' + entrance + ' does not exists');
                return;
            }

            if (file.useCompile 
                && ( file.isCssLike || file.isJsLike )
                && file.noMapJs !== false

            ) { 


                var fileExt;
                var content = [];

                var dependencies = {};
                function add_to_deps(k) {
                    dependencies[k] = 1;
                }

                walk_dep_tree(file, add_to_deps);
                var entrance_id = file.getId();
                var has = [entrance_id].concat(Object.keys(dependencies));
                // 这里假定无须手动处理依赖顺序
                var content = []; 
                var pkg_id = 'packdependencies_' + idx;

                if( file.isCssLike ){
                    fileExt = 'css';
                } else {
                    fileExt = 'js';
                }

                has.reverse().forEach(function( id ) {
                    var dep_file = src[id];
                    var dep_info = res[id];
                    if(!dep_file){
                        fis.log.warning('[packdependencies] dep id: ' + id + ' cannot be found with entrance :' + entrance_id);
                        return;
                    }

                    if( dep_info.pkg ){
                        fis.log.warning('[packdependencies] dep id: ' + id + ' has pkg : ' + dep_info.pkg + ' skip');
                        return;
                    } else if( dep_file.isCssLike != file.isCssLike || dep_file.isJsLike != file.isJsLike ){
                        fis.log.warning('[packdependencies] dep id: ' + id 
                                        + ' attr ( ' + JSON.stringify({ 
                                                    isCssLike : dep_file.isCssLike,
                                                    isJsLike : dep_file.isJsLike 
                                                }) + ') '
                                        + ' is not like entrance : ' + entrance_id + ' '
                                        + ' attr ( ' + JSON.stringify({ 
                                                    isCssLike : file.isCssLike,
                                                    isJsLike : file.isJsLike 
                                                }) + ') ');
                        return;
                    } else {
                        dep_info.pkg = pkg_id;
                    }

                    

                    content.push( dep_file.getContent() ); 
                });


                var subpath = settings.output
                                .replace('${index}', idx)
                                .replace('${hash}', 
                                    fis.util.md5(stable(has).join(','), 5)) + '.' + fileExt;

                var packed_file = fis.file(project_path, subpath);
                mpkg[pkg_id] = {
                    uri: packed_file.getUrl(opt.hash, opt.domain),
                    type: fileExt,
                    has: has
                };

                packed_file.setContent(content.join('\n'));

                pkg[packed_file.subpath] = packed_file;

            } else {
                fis.log.warning('entrance file : ' + entrance + ' does not match build condition');
            }
        });
    }

    file_deploy_path_check(ret);
};