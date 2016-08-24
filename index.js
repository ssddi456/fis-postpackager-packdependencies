/* global fis */

/*
 * fis
 * http://fis.baidu.com/
 */

'use strict';

var stable = require('stable');
var assert = require('assert');

var defaultSetting = {
    output: 'pkg/packdependencies_${hash}'
};

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

        var id_to_subpath_map = {};

        Object.keys(src).forEach(function( subpath ) {
            id_to_subpath_map[ src[subpath].getId() ] = subpath;
        });


        var id_to_subpath = function  ( id ) {
            return id_to_subpath_map[id];
        };


        entrances.map(function( entrance ) {
            if( typeof entrance == 'string' ){
                return { file : entrance, pack_siblings : true };
            } else {
                assert( typeof entrance.file == 'string', 'entrance.file must be string');
                return entrance;
            }
        }).forEach(function( entrance, idx ) {

            var file = fis.file( project_path, entrance.file );
            var pack_siblings = !!entrance.pack_siblings;

            if( !file.exists() ){
                fis.log.warning('[packdependencies] entrance file : ' + entrance.file + ' does not exists');
                return;
            }

            if( file.useCompile 
                && ( file.isCssLike || file.isJsLike )
                && file.noMapJs !== false
            ){
                var fileExt;
                var content = [];

                var dependencies = {};
                var entrance_id = file.getId();

                dependencies[entrance_id] = 1;
                var add_to_deps = function (k) {
                    dependencies[k] = 1;
                }

                walk_dep_tree(res[entrance_id], add_to_deps);

                var main_pack = {
                    has : [],
                    content : [],
                    pkg_id : 'packdependencies_' + idx,
                    fileExt : 'js'
                };

                var sibling_pack = {
                    has : [],
                    content : [],
                    pkg_id : 'packdependencies_' + idx + '_siblings',
                    fileExt : 'js'
                };


                if( file.isCssLike ){
                    main_pack.fileExt = 'css';
                    sibling_pack.fileExt = 'js';
                } else if( file.isJsLike ){
                    main_pack.fileExt = 'js';
                    sibling_pack.fileExt = 'css';
                } else {
                    fis.log.warning('[packdependencies] only css like file or js like file will be process, skip file : ' + entrance_id);
                    return;
                }

                var get_pack_content = function ( file ) {
                    if( file.isJsLike ){
                        return file.getContent() + ';';
                    } else if( file.isCssLike ){
                        return file.getContent().replace(/@charset\s+(?:'[^']*'|"[^"]*"|\S*);?/gi, '');
                    }
                };

                Object.keys(dependencies).reverse().forEach(function( id ) {
                    var dep_file = src[id_to_subpath(id)];
                    var dep_info = res[id];
                    if(!dep_file){
                        fis.log.warning('[packdependencies] dep id: ' + id + ' cannot be found with entrance :' + entrance_id);
                        return;
                    }

                    if( dep_info.pkg ){
                        fis.log.warning('[packdependencies] dep id: ' + id + ' has pkg : ' + dep_info.pkg + ' skip');
                        return;
                    } else if( dep_file.isCssLike != file.isCssLike || dep_file.isJsLike != file.isJsLike ){
                        //  这里假定 isCssLike 和 isJsLike 不可能同时为真
                        if( pack_siblings ){
                            sibling_pack.has.push(id);
                            sibling_pack.content.push( get_pack_content(dep_file) );
                            dep_info.pkg = sibling_pack.pkg_id;
                        } else {
                            fis.log.warning('[packdependencies] dep id: ' + id 
                                            + ' ' + JSON.stringify({ 
                                                    isCssLike : dep_file.isCssLike,
                                                    isJsLike : dep_file.isJsLike 
                                                }) + '\n'
                                            + ' is not the same as entrance : ' + entrance_id + ' '
                                            + ' ' + JSON.stringify({ 
                                                    isCssLike : file.isCssLike,
                                                    isJsLike : file.isJsLike 
                                                }) + '\n' 
                                            + ' this file will not pack together');
                        }

                        return;
                    } 

                    main_pack.has.push(id);
                    main_pack.content.push( get_pack_content(dep_file) ); 
                    dep_info.pkg = main_pack.pkg_id;
                });
                
                var create_package = function( pack ) {
                    if( pack.has.length <= 1 ){
                        return;
                    }

                    var subpath = settings.output
                                    .replace('${index}', idx)
                                    .replace('${hash}', 
                                        fis.util.md5(stable(pack.has).join(','), 5)) + '.' + pack.fileExt;

                    var packed_file = fis.file(project_path, subpath);
                    mpkg[pack.pkg_id] = {
                        uri: packed_file.getUrl(opt.hash, opt.domain),
                        type: pack.fileExt,
                        has: pack.has
                    };

                    packed_file.setContent(pack.content.join('\n'));

                    pkg[subpath] = packed_file;
                }

                create_package(main_pack);
                create_package(sibling_pack);

            } else {
                fis.log.warning('entrance file : ' + entrance + ' does not match build condition');
            }
        });
    }

    file_deploy_path_check(ret);
};