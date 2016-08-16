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



module.exports = function (ret, conf, settings, opt) { //打包后处理
    if (!opt.pack) {
        return;
    }


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

        ) { // 类html文件
            var fileExt;
            var dependencies = [];
            var content = [];

            if( file.isCssLike ){
                fileExt = 'css';
            } else {
                fileExt = 'js';
            }

            var has = [file.getId()].concat(dependencies);
            var subpath = settings.output
                            .replace('${index}', idx)
                            .replace('${hash}', 
                                fis.util.md5(stable(has).join(','), 5)) + '.' + fileExt;

            var packed_file = fis.file(project_path, subpath);
            var id = 'packdependencies_' + idx;
            ret.map.pkg[id] = {
                uri: packed_file.getUrl(opt.hash, opt.domain),
                type: fileExt,
                has: has
            };

            packed_file.setContent(content.join('\n'));

            ret.pkg[packed_file.subpath] = packed_file;
        } else {
            fis.log.warning('entrance file : ' + entrance + ' does not match build condition');
        }
    });

};