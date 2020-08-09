$(document).ready(async function() {

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

        async getChildren() {
            if (!this.childIds)
                return []
            var response = await requestVso('wit/workitems', { 'ids': this.childIds.join(','), '$expand': 'all'})
            console.log('get children response', response)
            return response.value.map(function(item) {
                return WorkItem.fromVsoResponse(item)
            })
        }

        static fromVsoResponse(response) {
            var item = new WorkItem()

            item.id = response.id.toString()
            item.wiType = response.fields['System.WorkItemType']
            item.title = response.fields['System.Title'].replace(/\[DOR\]/g, '')
            item.url = response._links.html.href.replace(/skype\.visualstudio\.com/, 'dev.azure.com/skype')
            item.state = response.fields['System.State']
            item.stateShort = response.fields['System.State'].replace(/ /g, '')
            item.swag = response.fields['Skype.Swag']
            item.assignedTo = response.fields['System.AssignedTo']
            item.assignedToShort = WorkItem.getAssignedToShort(item.assignedTo)
            item.column = response.fields['System.BoardColumn']
            item.columnShort = response.fields['System.BoardColumn'].replace(/ /g, '')
            if (!item.swag)
                item.swag = 1
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

        chart.empty();

        var item = await WorkItem.getById(epicId)

        console.log('work item', item)

        chart.append('<h1 class="epic"><a href=' + item.url + ' target="_blank">' + item.wiType + ' ' + item.id + '</a> ' + item.title + '</h1>')

        var children = await item.getChildren()

        console.log('children', children)

        var roots = {}

        children.forEach(function(item) {
            roots[item.id] = item
        })

        var graph = {}

        children.forEach(function(item) {
            graph[item.id] = {
                workItem: item,
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
        }
    }

    function renderDependencyGraph($chart, roots, graph) {

        var barLength = 60

        var calculateOffsets = function(offset, predecesor, ids) {

            ids.forEach(function(id) {

                var graphItem = graph[id]

                if (!graphItem)
                    return

                if (offset > graphItem.longestOffset) {
                    graphItem.longestOffset = offset
                    graphItem.longestPredecessor = predecesor
                }

                var successorIds = graphItem.workItem.successorIds
                if (successorIds) {
                    calculateOffsets(offset + graphItem.workItem.swag * barLength, graphItem.workItem, successorIds)
                }
            })
        }

        calculateOffsets(0, null, Object.keys(roots))

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
                        'class="column' + graphItem.workItem.columnShort + '" ' +
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

                $chart.append(
                    '<div ' +
                        'class="chart-row" ' +
                        'data-work-item-id="' + graphItem.workItem.id + '" ' +
                        'id="row-workItem' + graphItem.workItem.id + '">' +
                        '<div ' +
                            'style="' +
                                'margin-left: ' + graphItem.longestOffset + 'px; ' +
                            '" ' +
                        '>' +
                            columnTag +
                            predecessorsTag +
                            successorsTag +
                            assignedToTag +
                            workItemHref +
                            title +
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

    $('#button-login').click(login)
    $("#button-visualize").click(visualize)
    $("#button-logout").click(logout)

    $('#input-epicId').keypress(function (e) {
        if (e.which == 13) {
            visualize()
            return false
        }
    });

    $('#input-pat').keypress(function (e) {
        if (e.which == 13) {
            login()
            return false
        }
    });

    if (!credentials) {
        $("#view-login").show()
        return
    }

    $("#view-main").show()

    if (epicId) {
        $("#input-epicId").val(epicId)
        await renderEpic(epicId)
    }
})