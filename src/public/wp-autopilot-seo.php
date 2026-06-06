<?php
/**
 * Plugin Name: WP Autopilot – SEO Bridge
 * Description: Exposes the full Rank Math SEO meta (score, focus keyword, title, description, canonical, social/OG, schema) and common Astra layout meta over the REST API so WP Autopilot can read AND fill every field on publish.
 * Version: 1.1.0
 * Author: WP Autopilot
 *
 * INSTALL: upload this file to  wp-content/mu-plugins/  (create the folder if it
 * doesn't exist). Must-use plugins activate automatically — no activation needed.
 * Alternatively drop it in wp-content/plugins/ and activate it from Plugins.
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * 1) Expose the relevant Rank Math post-meta on the core REST endpoints so
 *    /wp-json/wp/v2/posts/<id> returns the score & focus keyword in edit context.
 */
add_action('init', function () {
    // Full Rank Math on-page + social + schema meta, plus common Astra per-post
    // layout meta — all read/write over REST so WP Autopilot can fill every field.
    $keys = [
        // Rank Math core
        'rank_math_seo_score', 'rank_math_focus_keyword', 'rank_math_title',
        'rank_math_description', 'rank_math_canonical_url', 'rank_math_pillar_content',
        'rank_math_robots',
        // Rank Math social (Open Graph / Twitter)
        'rank_math_facebook_title', 'rank_math_facebook_description', 'rank_math_facebook_image',
        'rank_math_twitter_title', 'rank_math_twitter_description', 'rank_math_twitter_image',
        // Rank Math schema / rich snippet
        'rank_math_rich_snippet', 'rank_math_snippet_article_type', 'rank_math_primary_category',
        // Astra theme per-post layout
        'site-sidebar-layout', 'site-content-layout', 'ast-title-bar-display',
        'site-post-title', 'ast-featured-img', 'theme-transparent-header-meta',
    ];
    foreach ($keys as $key) {
        register_meta('post', $key, [
            'show_in_rest'  => true,
            'single'        => true,
            'type'          => 'string',
            'auth_callback' => function () {
                return current_user_can('edit_posts');
            },
        ]);
    }
});

/**
 * 2) A fast bulk endpoint so the dashboard can fetch many scores in one request:
 *    GET /wp-json/wp-autopilot/v1/scores?ids=12,34,56
 *    (omit ?ids to get the 100 most recent published posts)
 */
add_action('rest_api_init', function () {
    register_rest_route('wp-autopilot/v1', '/scores', [
        'methods'             => 'GET',
        'permission_callback' => function () {
            return current_user_can('read');
        },
        'callback'            => function (WP_REST_Request $req) {
            $ids = array_filter(array_map('intval', array_filter(explode(',', (string) $req->get_param('ids')))));
            if (empty($ids)) {
                $ids = get_posts([
                    'post_type'   => ['post', 'page'],
                    'post_status' => 'publish',
                    'numberposts' => 100,
                    'fields'      => 'ids',
                ]);
            }
            $out = [];
            foreach ($ids as $id) {
                $score = get_post_meta($id, 'rank_math_seo_score', true);
                $out[] = [
                    'id'            => (int) $id,
                    'score'         => ($score === '' ? null : (int) $score),
                    'focus_keyword' => get_post_meta($id, 'rank_math_focus_keyword', true),
                    'pillar'        => get_post_meta($id, 'rank_math_pillar_content', true) === 'on',
                ];
            }
            return rest_ensure_response($out);
        },
    ]);

    // Simple health check so the app can detect the plugin is installed.
    register_rest_route('wp-autopilot/v1', '/ping', [
        'methods'             => 'GET',
        'permission_callback' => '__return_true',
        'callback'            => function () {
            return ['ok' => true, 'plugin' => 'wp-autopilot-seo', 'version' => '1.0.0', 'rankmath' => defined('RANK_MATH_VERSION')];
        },
    ]);
});
