$(document).ready(async function() {

    const adovisTitle = $('#adovis-title')

    if (!Array.prototype.last) {
        Array.prototype.last = function() {
            return this[this.length - 1]
        }
    }

    $(window).bind('hashchange', function(e) {
        location.reload()
    });

    let storage = window.localStorage

    let credentials = storage.getItem("credentials")

    let epicId = window.location.hash.trim()
    if (epicId.startsWith('#')) {
        epicId = epicId.substr(1)
    }

    let showClosed = false
    if (storage.getItem('showClosed'))
        showClosed = true

    let show2ndLevelChildren = false
    if (storage.getItem('show2ndLevelChildren'))
        show2ndLevelChildren = true

    console.log("epic ID is [", epicId, "]")

    function requestVso(resource, query) {
        return $.ajax({
            type: 'GET',
            url: 'https://skype.visualstudio.com/DefaultCollection/_apis/' + resource + '?api-version=1.0&' + $.param(query),
            dataType: 'json',
            headers: {
                'Authorization': 'Basic ' + btoa(credentials)
            }
        })
    }

    class WorkItem {

        static async getById(id) {
            var response = await requestVso('wit/workitems', { 'id': id, '$expand': 'all'})
            console.log('get by ID response', response)
            return WorkItem.fromVsoResponse(response)
        }

        static async getManyById(ids) {
            if (!ids || !ids.length)
                return []
            var response = await requestVso('wit/workitems', { 'ids': ids.join(','), '$expand': 'all'})
            console.log('get many by ID response', response)
            return response.value.map(function(item) {
                return WorkItem.fromVsoResponse(item)
            })
        }

        async getChildren() {
            return WorkItem.getManyById(this.childIds)
        }

        static fromVsoResponse(response) {
            var item = new WorkItem()

            item.id = response.id.toString()
            item.wiType = response.fields['System.WorkItemType']
            item.wiTypeShort = response.fields['System.WorkItemType'].replace(/ /g, '')
            item.title = response.fields['System.Title'].replace(/\[DOR\]/g, '')
            item.url = response._links.html.href.replace(/skype\.visualstudio\.com/, 'dev.azure.com/skype')
            item.state = response.fields['System.State']
            item.stateShort = response.fields['System.State'].replace(/ /g, '')
            item.swag = response.fields['Skype.Swag']
            item.assignedTo = response.fields['System.AssignedTo']
            item.assignedToShort = WorkItem.getAssignedToShort(item.assignedTo)
            item.column = response.fields['System.BoardColumn']
            item.columnShort = response.fields['System.BoardColumn'].replace(/ /g, '')
            item.parentId = WorkItem.getRelatedIds(response.relations, 'System.LinkTypes.Hierarchy-Reverse')
            item.childIds = WorkItem.getRelatedIds(response.relations, 'System.LinkTypes.Hierarchy-Forward')
            item.predecessorIds = WorkItem.getRelatedIds(response.relations, 'System.LinkTypes.Dependency-Reverse')
            item.successorIds = WorkItem.getRelatedIds(response.relations, 'System.LinkTypes.Dependency-Forward')

            return item
        }

        static getRelatedIds(relations, relType) {
            return relations
                .filter(function(item) {
                    return item.rel == relType
                })
                .map(function(item) {
                    return item.url.split('/').last()
                })
        }

        static getAssignedToShort(value) {
            return value ? value.replace(/[^A-Z]/g, '') : ''
        }
    }

    async function renderEpic(epicId) {

        var chart = $("#chart")

        adovisTitle.show()
        chart.hide()
        chart.empty()

        var item = await WorkItem.getById(epicId)

        console.log('work item', item)

        chart.append(
            '<h1 class="feature">' +
                '<a href=' + item.url + ' target="_blank">' + item.wiType + ' ' + item.id + '</a> ' +
                item.title +
            '</h1>')

        var children = await item.getChildren()

        var childrenToFetch = []
        for (var item of children)
            childrenToFetch = childrenToFetch.concat(item.childIds)

        if (show2ndLevelChildren) {

            var children2 = await WorkItem.getManyById(childrenToFetch)

            var children2WithExternalDependencies = []
            for (var child2 of children2) {
                for (var cessorId of child2.predecessorIds.concat(child2.successorIds)) {
                    var childCessors = children.filter(function(child) {
                        return child.id == cessorId
                    })
                    if (childCessors.length)
                        children2WithExternalDependencies.push(child2)
                    var child2Cessors = children2.filter(function(child) {
                        return child.id == cessorId && child.parentId != child2.parentId
                    })
                    if (child2Cessors.length)
                        children2WithExternalDependencies.push(child2)
                }
            }

            children = children.concat(children2WithExternalDependencies)
        }

        if (!showClosed)
            children = children.filter(item => item.state != 'Closed')

        console.log('children', children)

        var roots = {}

        children.forEach(function(item) {
            roots[item.id] = item
        })

        var graph = {}

        children.forEach(function(item) {
            graph[item.id] = {
                workItem: item,
                longestSwag: 0,
                longestOffset: 0,
                longestPredecessor: null
            }
            item.successorIds
                .forEach(function(id) {
                    delete roots[id]
                })
        })

        console.log('roots', roots)
        console.log('graph', graph)

        renderDependencyGraph(chart, roots, graph)

        if (graph) {
            chart.show(epicId)
            adovisTitle.hide()
        }
    }

    function renderDependencyGraph($chart, roots, graph) {

        var calculateOffsets = function(swag, offset, predecessor, ids) {

            ids.forEach(function(id) {

                var graphItem = graph[id]

                if (!graphItem)
                    return

                if (offset > graphItem.longestOffset) {
                    graphItem.longestSwag = swag
                    graphItem.longestOffset = offset
                    graphItem.longestPredecessor = predecessor
                }

                var successorIds = graphItem.workItem.successorIds
                if (successorIds) {
                    calculateOffsets(
                      (swag != null && graphItem.workItem.swag) ? (swag + graphItem.workItem.swag) : null,
                      offset + (graphItem.workItem.swag ? graphItem.workItem.swag : 1),
                      graphItem.workItem,
                      successorIds)
                }
            })
        }

        calculateOffsets(0, 0, null, Object.keys(roots))

        var renderItems = function($chart, predecessor, unorderedIds) {

            var ids = unorderedIds.slice(0)
            ids.sort()

            ids.forEach(function(id) {

                var graphItem = graph[id]

                if (!graphItem || graphItem.longestPredecessor != predecessor)
                    return

                var numPredecessors = graphItem.workItem.predecessorIds.length
                var numOtherPredecessors = numPredecessors - 1
                var hasOtherPredecessors = numOtherPredecessors > 0

                var numOtherSuccessors = 0
                graphItem.workItem.successorIds.forEach(function(successorId) {
                    var successorGraphItem = graph[successorId]
                    if (!successorGraphItem)
                        return
                    if (successorGraphItem.longestPredecessor != graphItem.workItem)
                        numOtherSuccessors++
                })
                var hasOtherSuccessors = numOtherSuccessors > 0

                var columnTag = (
                    '<span ' +
                        'class="column-' + graphItem.workItem.columnShort + '" ' +
                    '>' +
                        graphItem.workItem.column +
                    '</span> '
                )

                var predecessorsTag = (
                    hasOtherPredecessors
                        ? '<span class="predecessors" title="Other predecessors, click to highlight">' + numOtherPredecessors + '</span> '
                        : ''
                )

                var successorsTag = (
                    hasOtherSuccessors
                        ? '<span class="successors" title="Other successors, click to highlight">' + numOtherSuccessors + '</span> '
                        : ''
                )

                var assignedToTag = (
                    graphItem.workItem.assignedToShort && graphItem.workItem.state != 'Closed'
                        ? ('<span class="assignedTo">' + graphItem.workItem.assignedToShort + '</span> ')
                        : ''
                )

                var workItemHref = (
                    '<a ' +
                        'href="' + graphItem.workItem.url + '"' +
                    ' target="_blank">' +
                        id +
                    '</a> '
                )

                var title = (
                    '<span class="title">' +
                        graphItem.workItem.title +
                    '</span>'
                )

                const barLenght = 40;

                const thisSwag = graphItem.workItem.swag ? graphItem.workItem.swag : '?'
                const totalSwag =
                    (graphItem.longestSwag != null && graphItem.workItem.swag)
                        ? (graphItem.longestSwag + graphItem.workItem.swag)
                        : '?'

                $chart.append(
                    '<div ' +
                        'class="chart-row" ' +
                        'data-work-item-id="' + graphItem.workItem.id + '" ' +
                        'id="row-workItem' + graphItem.workItem.id + '">' +
                        '<div ' +
                            'style="' +
                                'margin-left: ' + graphItem.longestOffset * barLenght + 'px; ' +
                            '" ' +
                        '>' +
                            '<div class="task-' + graphItem.workItem.wiTypeShort + '">' +
                                columnTag +
                                assignedToTag +
                                predecessorsTag +
                                successorsTag +
                                workItemHref +
                                title + (
                                    graphItem.workItem.wiType == 'Epic'
                                        ? ' <span class="swag" title="Swag / total swag to completion">' + thisSwag + ' / ' + totalSwag + '</span>'
                                        : ''
                                ) +
                            '</div>' +
                        '</div>' +
                    '</div>')

                var successorIds = graphItem.workItem.successorIds
                if (successorIds) {
                    renderItems($chart, graphItem.workItem, successorIds)
                }
            })
        }

        renderItems($chart, null, Object.keys(roots))

        var toggleHighlightDependencies = function($row) {
            var workItemId = $row.data('workItemId')
            var highlighted = $row.hasClass('chart-row-highlighted')
            var graphItem = graph[workItemId]

            if (!highlighted) {

                $row.addClass('chart-row-highlighted')

                if (graphItem.longestPredecessor)
                    graphItem.workItem.predecessorIds.forEach(function(predecessorId) {
                        if (predecessorId != graphItem.longestPredecessor.id)
                            $('#row-workItem' + predecessorId).addClass('chart-row-predecessor-highlighted')
                    })

                graphItem.workItem.successorIds.forEach(function(successorId) {
                    var successorGraphItem = graph[successorId]
                    if (workItemId != successorGraphItem.longestPredecessor.id)
                        $('#row-workItem' + successorId).addClass('chart-row-successor-highlighted')
                })

            } else {

                $row.removeClass('chart-row-highlighted')

                if (graphItem.longestPredecessor)
                    graphItem.workItem.predecessorIds.forEach(function(predecessorId) {
                        if (predecessorId != graphItem.longestPredecessor.id)
                            $('#row-workItem' + predecessorId).removeClass('chart-row-predecessor-highlighted')
                    })

                graphItem.workItem.successorIds.forEach(function(successorId) {
                    var successorGraphItem = graph[successorId]
                    if (workItemId != successorGraphItem.longestPredecessor.id)
                        $('#row-workItem' + successorId).removeClass('chart-row-successor-highlighted')
                })
            }
        }

        $('.chart-row').click(
            function() {

                var $this = $(this)
                var $current = $('.chart-row-highlighted')

                if ($current.length != 0 && !$current.is($this)) {
                    toggleHighlightDependencies($current)
                }

                toggleHighlightDependencies($this)
            })
    }

    function login() {

        $("#view-main").show()
        $("#view-login").hide()

        credentials = "adovis:" + $("#input-pat").val()
        $("#input-pat").val("")
        storage.setItem("credentials", credentials)

        renderEpic(epicId);
    }

    async function visualize(epicId) {
        epicId = $("#input-epicId").val()
        window.location.hash = '#' + epicId
        await renderEpic(epicId)
    }

    function logout() {
        $("#view-main").hide()
        $("#view-login").show()

        credentials = null
        storage.removeItem("credentials")
    }

    function updateInputEpicValue(epicId) {
        $("#input-epicId").val(epicId)
    }

    function toggleShowClosed() {
        if (showClosed) {
            showClosed = false;
            storage.removeItem('showClosed')
        } else {
            showClosed = true;
            storage.setItem('showClosed', 'true')
        }
        visualize()
    }

    function toggleShowClosed() {
        if (showClosed) {
            showClosed = false;
            storage.removeItem('showClosed')
        } else {
            showClosed = true;
            storage.setItem('showClosed', 'true')
        }
        visualize()
    }

    function toggleShow2ndLevelChildren() {
        if (show2ndLevelChildren) {
            show2ndLevelChildren = false;
            storage.removeItem('show2ndLevelChildren')
        } else {
            show2ndLevelChildren = true;
            storage.setItem('show2ndLevelChildren', 'true')
        }
        visualize()
    }

    $('#button-login').click(login)
    $('#button-visualize').click(visualize)
    $('#button-logout').click(logout)
    $('#checkbox-show-closed').click(toggleShowClosed).attr('checked', showClosed)
    $('#checkbox-show-2nd-level-children').click(toggleShow2ndLevelChildren).attr('checked', show2ndLevelChildren)

    $('#input-epicId').keypress(function (e) {
        if (e.which == 13) {
            visualize()
            return false
        }
    })

    $('#input-pat').keypress(function (e) {
        if (e.which == 13) {
            login()
            return false
        }
    })

    if (!credentials) {
        $('#view-login').show()
        return
    }

    $("#view-main").show()

    if (epicId) {
        updateInputEpicValue(epicId)
        await renderEpic(epicId)
    }
})