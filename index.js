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

        function id_to_subpath ( id ) {
            return id_to_subpath_map[id];
        };


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
                var entrance_id = file.getId();

                dependencies[entrance_id] = 1;
                function add_to_deps(k) {
                    dependencies[k] = 1;
                }

                walk_dep_tree(res[entrance_id], add_to_deps);

                var has = Object.keys(dependencies);

                // 这里假定无须手动处理依赖顺序
                var content = []; 
                var pkg_id = 'packdependencies_' + idx;

                if( file.isCssLike ){
                    fileExt = 'css';
                } else {
                    fileExt = 'js';
                }


                has.reverse().forEach(function( id ) {
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


                    var sub_content = dep_file.getContent();

                    if( fileExt == 'js' ){
                        if( sub_content[sub_content.length -1] != ';' ){
                            sub_content += ';';
                        }
                    } else if( fileExt  == 'css' ){
                        sub_content = sub_content.replace(/@charset\s+(?:'[^']*'|"[^"]*"|\S*);?/gi, '');
                    }
                    

                    content.push( sub_content ); 
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